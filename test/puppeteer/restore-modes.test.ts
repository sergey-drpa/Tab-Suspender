/**
 * Tab Suspender — Restore Modes E2E Test
 *
 * Covers test cases 2.3 and 2.4:
 *   2.3 — reloadTabOnRestore=false → restore via browser history (bfcache / history.go(-1))
 *   2.4 — reloadTabOnRestore=true  → restore via direct navigation (chrome.tabs.update / location.replace)
 *
 * Both modes must return the tab to its original URL. The mechanism differs:
 *   false → park.ts calls window.history.go(-1) or location.replace (historyFallback)
 *   true  → park.ts calls location.replace directly, or unsuspendTab calls chrome.tabs.update
 *
 * A local HTTP server is used so we have a stable URL under our control.
 *
 * Run:
 *   cd test/puppeteer && npx tsx restore-modes.test.ts
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  suspendTabById,
  unsuspendTabById,
  waitForParkPages,
  queryChromeTabs,
  getSetting,
  setSetting,
  waitForAnyTabToLeaveParked,
  waitForTabToRestore,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-restore-modes');

function startHttpServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Restore Modes Test</title></head><body>Restore Test Page</body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
    server.on('error', reject);
  });
}

async function suspendAndRestore(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  extensionId: string,
  targetUrl: string,
  modeName: string,
): Promise<string | null> {
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 10000 });
  await sleep(1000);

  const tabs = await queryChromeTabs(browser);
  const tab = tabs.find(t => t.url && t.url.startsWith('http://127.0.0.1'));
  if (!tab) return null;

  // Focus away so the target tab is inactive
  const blank = await browser.newPage();
  await blank.goto('about:blank');
  await sleep(300);

  log(`  [${modeName}] Suspending tab ${tab.id}...`);
  await suspendTabById(browser, tab.id);
  await waitForParkPages(browser, extensionId, 1, 15000);
  log(`  [${modeName}] park.html appeared`);

  // Find current park tab ID (may equal tab.id)
  const allTabs = await queryChromeTabs(browser);
  const parkTab = allTabs.find(t => t.url && t.url.startsWith(parkUrlPrefix(extensionId)));
  const parkTabId = parkTab?.id ?? tab.id;
  log(`  [${modeName}] park tab url: ${parkTab?.url?.slice(0, 100)}`);

  // Capture park page console logs for debugging
  const parkPages = await browser.pages();
  const parkPage = parkPages.find(p => p.url().includes('park.html'));
  if (parkPage) {
    parkPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Back') || text.includes('Reload') || text.includes('goBack') || text.includes('Issue #4') || text.includes('No valid restore URL')) {
        log(`  [${modeName}] park.ts: ${text}`);
      }
    });
  }

  log(`  [${modeName}] Restoring tab ${parkTabId}...`);
  // Wait for the park page to finish loading before unsuspending. park.ts
  // requests its parkData exactly once at script start; unsuspendTab's
  // status='loading' branch relies on winning a race against that request
  // (markForUnsuspend must land first), which is inherently flaky. The
  // deterministic path — and the realistic user scenario — is unsuspending a
  // fully loaded park page (unsuspendTab then sends RestoreMessage and
  // park.ts calls goBack).
  for (let i = 0; i < 40; i++) {
    const t = (await queryChromeTabs(browser)).find(x => x.id === parkTabId);
    if (t && t.status === 'complete') break;
    await sleep(250);
  }
  const preRestoreTabs = await queryChromeTabs(browser);
  const preRestoreTab = preRestoreTabs.find(t => t.id === parkTabId);
  log(`  [${modeName}] tab status before restore: ${preRestoreTab?.status}, url: ${preRestoreTab?.url?.slice(0, 80)}`);
  await unsuspendTabById(browser, parkTabId);

  const restoredUrl = await waitForAnyTabToLeaveParked(browser, extensionId, '127.0.0.1', 20000)
    .catch(() => waitForTabToRestore(browser, parkTabId, 20000).catch(() => null));

  // Cleanup: close the extra blank page
  await blank.close().catch(() => {});
  // Close the restored page too so next phase starts clean
  const pages = await browser.pages();
  const restoredPage = pages.find(p => p.url().includes('127.0.0.1'));
  await restoredPage?.close().catch(() => {});

  return restoredUrl;
}

async function main(): Promise<void> {
  log('Tab Suspender — Restore Modes (bfcache vs force reload)');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { server, url: testUrl } = await startHttpServer();
  log(`HTTP server: ${testUrl}`);

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  const originalReload = await (async () => {
    const extensionId = await getExtensionId(browser);
    return getSetting(browser, 'reloadTabOnRestore');
  })();

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — reloadTabOnRestore = false  (bfcache / history fallback)
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — reloadTabOnRestore=false (bfcache/history)');

    await setSetting(browser, 'reloadTabOnRestore', false);
    runner.assert(
      await getSetting(browser, 'reloadTabOnRestore') === false,
      'reloadTabOnRestore set to false',
    );

    const urlA = await suspendAndRestore(browser, extensionId, testUrl, 'bfcache');
    runner.assert(
      urlA != null && urlA.includes('127.0.0.1'),
      `reloadTabOnRestore=false: tab restored to original URL (got: ${urlA})`,
    );

    await sleep(500);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — reloadTabOnRestore = true  (force reload / direct navigation)
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — reloadTabOnRestore=true (force reload)');

    await setSetting(browser, 'reloadTabOnRestore', true);
    runner.assert(
      await getSetting(browser, 'reloadTabOnRestore') === true,
      'reloadTabOnRestore set to true',
    );

    const urlB = await suspendAndRestore(browser, extensionId, testUrl, 'reload');
    runner.assert(
      urlB != null && urlB.includes('127.0.0.1'),
      `reloadTabOnRestore=true: tab restored to original URL (got: ${urlB})`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  TEARDOWN
    // ══════════════════════════════════════════════════════════════════════════
    await setSetting(browser, 'reloadTabOnRestore', originalReload ?? false);

  } finally {
    await browser.close();
    server.close();
    log('Browser closed, server stopped');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
