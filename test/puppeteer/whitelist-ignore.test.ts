/**
 * Tab Suspender — Whitelist & Ignore E2E Test
 *
 * Covers test cases 3.4, 3.5, 3.9 (and 17.4 which uses same logic as 3.4):
 *   3.4  — Add URL to whitelist → tab with that URL cannot be suspended
 *   3.5  — Remove pattern → tab becomes suspendable again
 *   3.9  — Ignore tab (per-session) → tab not suspended until browser restart
 *   17.4 — "Add to Whitelist" action uses same underlying whiteList.addPattern()
 *
 * Implementation note:
 *   Context menu / keyboard shortcut UI is not testable with puppeteer, so we
 *   call the same underlying API methods that the menu actions use:
 *     whiteList.addPattern(pattern)
 *     whiteList.removePatternsAffectUrl(url)
 *     ignoreList.addToIgnoreTabList(tabId)
 *     ignoreList.isTabInIgnoreTabList(tabId)
 *
 * Run:
 *   cd test/puppeteer && npx tsx whitelist-ignore.test.ts
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  queryChromeTabs,
  getParkPages,
  parkUrlPrefix,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-whitelist');

function startServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Whitelist Test</title></head><body>Test</body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
    server.on('error', reject);
  });
}

async function isWhitelisted(browser: Awaited<ReturnType<typeof launchBrowser>>, url: string): Promise<boolean> {
  return evalInSW<boolean>(browser, `whiteList.isURIException(${JSON.stringify(url)})`);
}

async function isIgnored(browser: Awaited<ReturnType<typeof launchBrowser>>, tabId: number): Promise<boolean> {
  return evalInSW<boolean>(browser, `ignoreList.isTabInIgnoreTabList(${tabId})`);
}

// Open a tab to testUrl, move focus away, call parkTabs() (which respects the whitelist),
// and check if the tab got parked. Returns { parked, tabId }.
async function tryToSuspend(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  extensionId: string,
  testUrl: string,
  timeoutMs = 6000,
): Promise<{ parked: boolean; tabId: number }> {
  const page = await browser.newPage();
  await page.goto(testUrl, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
  await sleep(1000);

  const tabs = await queryChromeTabs(browser);
  const tab = tabs.find(t => t.url && t.url.startsWith(testUrl));
  if (!tab) return { parked: false, tabId: -1 };

  const tabId = tab.id;

  // Keep a blank tab active so it won't be targeted by parkTabs
  const blank = await browser.newPage();
  await blank.goto('about:blank');
  await sleep(300);

  // Use parkTabs() — this is the path that respects isExceptionTab() / whitelist.
  // Direct parkTab() bypasses the whitelist check.
  await evalInSW(browser, 'parkTabs()');

  const parkPrefix = parkUrlPrefix(extensionId);
  const deadline = Date.now() + timeoutMs;
  let parked = false;
  while (Date.now() < deadline) {
    const allTabs = await queryChromeTabs(browser);
    if (allTabs.some(t => t.id === tabId && t.url && t.url.startsWith(parkPrefix))) {
      parked = true;
      break;
    }
    await sleep(500);
  }

  // Cleanup
  await blank.close().catch(() => {});
  await page.close().catch(() => {});

  return { parked, tabId };
}

async function main(): Promise<void> {
  log('Tab Suspender — Whitelist & Ignore');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { server, url: testUrl } = await startServer();
  const testHost = new URL(testUrl).hostname + ':' + new URL(testUrl).port;
  const whitelistPattern = `*${testHost}*`;
  log(`HTTP server: ${testUrl}`);
  log(`Whitelist pattern: ${whitelistPattern}`);

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    log('  Waiting for extension full init (whiteList/ignoreList)...');
    await waitForExtensionInit(browser);
    log('  Extension initialized');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Add URL to whitelist (3.4 / 17.4)
    //  Tab with whitelisted URL must not get parked.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Add URL to whitelist → tab not suspended (3.4)');

    // Verify not yet whitelisted
    const beforeAdd = await isWhitelisted(browser, testUrl);
    runner.softAssert(!beforeAdd, `URL not yet whitelisted before add (got: ${beforeAdd})`);

    // Add pattern via whiteList API (same call as context menu "Add to Whitelist")
    await evalInSW(browser, `whiteList.addPattern(${JSON.stringify(whitelistPattern)})`);
    await sleep(400);

    const afterAdd = await isWhitelisted(browser, testUrl);
    runner.assert(afterAdd === true, `URL is whitelisted after addPattern (got: ${afterAdd})`);
    log(`  Whitelist check: isURIException("${testUrl}") = ${afterAdd}`);

    // Try to suspend a tab with this URL — it should be protected
    const { parked: parkedWhenWhitelisted, tabId: whitelistedTabId } =
      await tryToSuspend(browser, extensionId, testUrl, 5000);

    runner.assert(
      !parkedWhenWhitelisted,
      'Whitelisted tab was NOT suspended (parkTab returned early due to isExceptionTab)',
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Remove from whitelist (3.5)
    //  After removal, the same URL should be suspendable again.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Remove from whitelist → tab suspendable again (3.5)');

    await evalInSW(browser, `whiteList.removePatternsAffectUrl(${JSON.stringify(testUrl)})`);
    await sleep(400);

    const afterRemove = await isWhitelisted(browser, testUrl);
    runner.assert(!afterRemove, `URL no longer whitelisted after remove (got: ${afterRemove})`);

    // Now suspending should work
    const { parked: parkedAfterRemoval } = await tryToSuspend(browser, extensionId, testUrl, 8000);
    runner.assert(
      parkedAfterRemoval,
      'Tab suspended after whitelist pattern removed',
    );

    // Clean up any lingering park pages
    const parkPages = await getParkPages(browser, extensionId);
    for (const p of parkPages) await p.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Ignore tab per-session (3.9)
    //  Mark tab as ignored → parkTab returns early for that tab.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — Ignore tab per-session → not suspended (3.9)');

    const ignorePage = await browser.newPage();
    await ignorePage.goto(testUrl, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
    await sleep(1000);

    const tabs = await queryChromeTabs(browser);
    const ignoreTab = tabs.find(t => t.url && t.url.startsWith(testUrl));
    runner.assert(ignoreTab != null, 'Test tab found for ignore test');

    const ignoreTabId = ignoreTab!.id;

    // Mark tab as ignored
    await evalInSW(browser, `ignoreList.addToIgnoreTabList(${ignoreTabId})`);
    await sleep(200);

    const ignored = await isIgnored(browser, ignoreTabId);
    runner.assert(ignored === true, `Tab ${ignoreTabId} is now in ignore list`);

    // Attempt to suspend via parkTabs() which respects the ignore list
    const blank = await browser.newPage();
    await blank.goto('about:blank');
    await sleep(300);

    await evalInSW(browser, 'parkTabs()');
    await sleep(4000); // wait to see if park.html appears

    const parkPrefix = parkUrlPrefix(extensionId);
    const tabsAfterIgnoreSuspend = await queryChromeTabs(browser);
    const ignoreTabStillNormal = tabsAfterIgnoreSuspend.find(
      t => t.id === ignoreTabId && t.url && !t.url.startsWith(parkPrefix),
    );

    runner.assert(
      ignoreTabStillNormal != null,
      `Ignored tab ${ignoreTabId} was NOT suspended`,
    );

    // Verify ignore is removed after unmark
    await evalInSW(browser, `ignoreList.removeFromIgnoreTabList(${ignoreTabId})`);
    const unignored = await isIgnored(browser, ignoreTabId);
    runner.softAssert(!unignored, 'Tab removed from ignore list after removeFromIgnoreTabList');

    await blank.close().catch(() => {});

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
