/**
 * Tab Suspender — Unfocused Tab Discard E2E Test
 *
 * Covers test case 9.3:
 *   openUnfocusedTabDiscarded=true → a tab opened in the background
 *   (active=false) is automatically discarded by the extension.
 *
 * Mechanism (TabManager.ts onCreated handler):
 *   When a tab is created with tab.active === false and the setting is true,
 *   tabInfo.markedForDiscard = true is set.
 *   Later in onUpdated, when the tab is still loading in background and has
 *   a title and favicon, discardTab(tab.id) is called.
 *
 * Flow:
 *   Phase A — Baseline: openUnfocusedTabDiscarded=false.
 *             Open background tab → it should NOT be auto-discarded.
 *   Phase B — openUnfocusedTabDiscarded=true.
 *             Open background tab → it SHOULD be auto-discarded.
 *
 * Run:
 *   cd test/puppeteer && npx tsx unfocused-tab-discard.test.ts
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  getSetting,
  setSetting,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-unfocused-discard');

// Tiny transparent 1x1 PNG as a data URI used as favicon
const FAVICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function startServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      // Stream in two chunks with a 300ms pause so Chrome has time to parse
      // <title> and <link rel="icon"> while tab.status is still 'loading'.
      res.writeHead(200, { 'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked' });
      res.write(`<html><head>
        <title>Unfocused Discard Test</title>
        <link rel="icon" href="${FAVICON_DATA}">
      </head><body>`);
      setTimeout(() => {
        res.end('Unfocused Tab Discard Test</body></html>');
      }, 300);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
    server.on('error', reject);
  });
}

// Opens a new tab in the background (active=false) via chrome.tabs.create,
// polls until it is discarded OR the timeout expires.
async function openBackgroundTab(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  url: string,
  waitMs = 10000,
): Promise<{ tabId: number; discarded: boolean }> {
  const json = await evalInSW<string>(browser, `(async () => {
    const tab = await chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false });
    return JSON.stringify({ id: tab.id });
  })()`);
  const { id: tabId } = JSON.parse(json);
  log(`  Background tab created: id=${tabId}`);

  // Poll until discarded=true or full timeout (don't break on 'complete':
  // the extension discards mid-load, but if it misses the window the tab
  // may finish loading without being discarded).
  const deadline = Date.now() + waitMs;
  let lastTab: { discarded: boolean; status: string } | null = null;
  while (Date.now() < deadline) {
    const info = await evalInSW<string>(browser, `(async () => {
      const t = await chrome.tabs.get(${tabId}).catch(() => null);
      return JSON.stringify(t ? { discarded: t.discarded, status: t.status } : null);
    })()`);
    if (!info) break;
    lastTab = JSON.parse(info);
    if (lastTab?.discarded) break;
    await sleep(500);
  }

  return { tabId, discarded: lastTab?.discarded ?? false };
}

async function main(): Promise<void> {
  log('Tab Suspender — Unfocused Tab Discard');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { server, url: testUrl } = await startServer();
  log(`HTTP server: ${testUrl}`);

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    const originalSetting = await getSetting(browser, 'openUnfocusedTabDiscarded');
    log(`  openUnfocusedTabDiscarded default: ${originalSetting}`);

    // Keep a foreground tab active throughout so background tabs are truly inactive
    const fgPage = await browser.newPage();
    await fgPage.goto('about:blank');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Baseline: setting disabled
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — openUnfocusedTabDiscarded=false baseline');

    await setSetting(browser, 'openUnfocusedTabDiscarded', false);

    const { tabId: tabIdA, discarded: discardedA } =
      await openBackgroundTab(browser, testUrl);

    log(`  Tab ${tabIdA}: discarded=${discardedA}`);
    runner.softAssert(
      !discardedA,
      `Background tab NOT auto-discarded when setting is false (discarded=${discardedA})`,
    );

    await evalInSW(browser, `chrome.tabs.remove(${tabIdA})`).catch(() => {});
    await sleep(300);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Setting enabled: background tab should be discarded
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — openUnfocusedTabDiscarded=true → background tab discarded');

    await setSetting(browser, 'openUnfocusedTabDiscarded', true);
    runner.assert(
      await getSetting(browser, 'openUnfocusedTabDiscarded') === true,
      'openUnfocusedTabDiscarded set to true',
    );

    const { tabId: tabIdB, discarded: discardedB } =
      await openBackgroundTab(browser, testUrl, 12000);

    log(`  Tab ${tabIdB}: discarded=${discardedB}`);
    runner.assert(
      discardedB === true,
      `Background tab auto-discarded when openUnfocusedTabDiscarded=true (discarded=${discardedB})`,
    );

    await evalInSW(browser, `chrome.tabs.remove(${tabIdB})`).catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  TEARDOWN
    // ══════════════════════════════════════════════════════════════════════════
    await setSetting(browser, 'openUnfocusedTabDiscarded', originalSetting ?? false);

  } finally {
    await browser.close();
    server.close();
    log('Browser closed');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
