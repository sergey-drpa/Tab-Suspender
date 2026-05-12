/**
 * Tab Suspender — Basic Suspend / Restore E2E Test
 *
 * Covers test cases 1.1 and 2.1:
 *   1.1 — A tab is auto-suspended by the extension timer (URL changes to park.html)
 *   2.1 — The suspended tab is restored to its original URL
 *
 * Flow:
 *   Phase A — Open a page, move focus away, let the extension's own ticker
 *             auto-suspend the tab (timeout=10s, the minimum).
 *             Verify the tab URL becomes park.html and tabInfo._parked = true.
 *   Phase B — Call unsuspendTab on the parked tab.
 *             Verify the tab URL returns to the original page.
 *   Phase C — TabInfo sanity after restore:
 *             _parked must be false / null after the tab navigates away from park.html.
 *
 * Run:
 *   cd test/puppeteer && npx tsx basic-suspend-restore.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  unsuspendTabById,
  waitForParkPages,
  queryChromeTabs,
  getTabInfosCopy,
  waitForTabToRestore,
  parkUrlPrefix,
  getSetting,
  setSetting,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-basic-suspend');
const TARGET_URL  = 'https://example.com/';

async function main(): Promise<void> {
  log('Tab Suspender — Basic Suspend / Restore');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let originalTimeout: number | null = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    // Set minimum timeout so the extension auto-suspends quickly
    originalTimeout = await getSetting<number>(browser, 'timeout');

    // Close any stale extension tabs (e.g. wizard_background.html) that have accumulated
    // inactivity time — they would be suspended first and confuse the test.
    const tabsBefore = await queryChromeTabs(browser);
    log(`  Tabs before setup: ${tabsBefore.map(t => `id=${t.id} url=${(t.url || '').slice(0, 60)}`).join(' | ')}`);
    const extensionTabs = tabsBefore.filter(
      t => t.url && t.url.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html'),
    );
    for (const et of extensionTabs) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
      log(`  Closed extension tab ${et.id} (${et.url?.slice(0, 60)})`);
    }
    await sleep(300);

    await setSetting(browser, 'timeout', 10);
    log(`  timeout set to 10s (was ${originalTimeout}s)`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Auto-suspend via extension timer
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Auto-suspend via extension timer (timeout=10s)');

    const targetPage = await browser.newPage();
    await targetPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(2000); // ensure tab reaches status='complete'

    const tabs = await queryChromeTabs(browser);
    const targetTab = tabs.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetTab != null, 'example.com tab exists before suspend');

    const tabId = targetTab!.id;
    const parkPrefix = parkUrlPrefix(extensionId);

    // Move focus to a blank tab so example.com becomes inactive — starts the inactivity timer
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(500); // let extension register the focus change

    log(`  Waiting for example.com tab ${tabId} to be auto-suspended (timeout=10s)...`);

    // Poll specifically for the example.com tab to become park.html (not just any park page)
    const deadline = Date.now() + 35000;
    let parkedTabId: number | null = null;
    while (Date.now() < deadline) {
      const json = await evalInSW<string>(browser, `(async () => {
        const t = await chrome.tabs.get(${tabId}).catch(() => null);
        return JSON.stringify(t ? { url: t.url } : null);
      })()`);
      if (json) {
        const t = JSON.parse(json) as { url: string } | null;
        if (t && t.url.startsWith(parkPrefix)) {
          parkedTabId = tabId;
          break;
        }
      }
      await sleep(1000);
    }

    runner.assert(parkedTabId != null, `example.com tab ${tabId} was auto-suspended to park.html`);

    const tabInfos = await getTabInfosCopy(browser);
    // Tab info is keyed by original tab ID; after replacement it may differ
    const anyParked = Object.values(tabInfos).some(info => info._parked === true);
    runner.softAssert(anyParked, 'tabManager has at least one _parked=true TabInfo');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Restore
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Restore tab');

    log(`  Unsuspending tab ${parkedTabId}...`);
    await unsuspendTabById(browser, parkedTabId);

    const restoredUrl = await waitForTabToRestore(browser, parkedTabId, 20000)
      .catch(async () => {
        // Tab ID may have changed; look for example.com in any tab
        const t = await queryChromeTabs(browser).then(ts => ts.find(x => x.url?.includes('example.com')));
        return t?.url ?? null;
      });

    runner.assert(
      typeof restoredUrl === 'string' && restoredUrl.includes('example.com'),
      `Tab navigated back to example.com after restore (got: ${restoredUrl})`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — TabInfo sanity after restore
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — TabInfo after restore');

    await sleep(1500); // give extension time to process onUpdated / onActivated

    const tabInfosAfter = await getTabInfosCopy(browser);
    const stillParked = Object.values(tabInfosAfter).some(
      info => info._parked === true && !info._closed,
    );
    runner.softAssert(!stillParked, 'No open tab has _parked=true after restore');

  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    await browser.close();
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
