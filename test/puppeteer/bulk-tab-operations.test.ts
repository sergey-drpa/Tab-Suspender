/**
 * Tab Suspender — Bulk Tab Operations E2E Test
 *
 * Covers test cases 17.1, 17.2, 17.3, 2.10:
 *   17.1 — "Suspend Current Tab": parkTab(activeTab) suspends the currently active tab
 *   17.2 — "Suspend All Other Tabs": parkTabs(currentTab) suspends all except current
 *   17.3 — "Unsuspend Current Window": unsuspendTabs(windowId) restores all in the window
 *   2.10 — Bulk restore with staggered delays works end-to-end
 *
 * These correspond to the keyboard shortcut / context menu commands:
 *   suspend-current     → parkTab(tab, tab.id)
 *   suspend-all-other   → parkTabs(tab)          [excludes active tab]
 *   unsuspend-current-window → unsuspendTabs(tab.windowId)
 *
 * Run:
 *   cd test/puppeteer && npx tsx bulk-tab-operations.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  queryChromeTabs,
  waitForParkPages,
  getParkPages,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-bulk-ops');

const URL_A = 'https://example.com/';
const URL_B = 'data:text/html,<title>Tab B</title><body>Tab B</body>';
const URL_C = 'data:text/html,<title>Tab C</title><body>Tab C</body>';

async function getActiveTab(browser: Awaited<ReturnType<typeof launchBrowser>>) {
  const json = await evalInSW<string>(browser, `(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return JSON.stringify(tabs[0] ?? null);
  })()`);
  return json ? JSON.parse(json) : null;
}

async function main(): Promise<void> {
  log('Tab Suspender — Bulk Tab Operations');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);
    const parkPrefix = parkUrlPrefix(extensionId);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Suspend All Other Tabs (17.2)
    //  Open tabs A, B, C. Make the blank (default) tab active. Suspend all others.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Suspend All Other Tabs (17.2)');

    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    const pageC = await browser.newPage();

    await Promise.all([
      pageA.goto(URL_A, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
      pageB.goto(URL_B, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
      pageC.goto(URL_C, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
    ]);
    await sleep(1500);

    // Create a "control" tab that stays active (will not be suspended)
    const controlPage = await browser.newPage();
    await controlPage.goto('about:blank');
    await sleep(500);

    const activeTab = await getActiveTab(browser);
    log(`  Active (control) tab ID: ${activeTab?.id}`);
    runner.assert(activeTab != null, 'Control tab is active');

    const windowId = activeTab?.windowId;

    // Call parkTabs(currentTab) — suspends all except active tab
    log('  Calling parkTabs(activeTab) — suspend all others...');
    await evalInSW(browser, `(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) parkTabs(tabs[0]);
    })()`);

    // Wait for at least 3 park pages (A, B, C — but data: URLs are not allowed)
    // Only http/https tabs can be parked. URL_A (example.com) qualifies.
    // data: URLs are not allowed by isTabURLAllowedForPark.
    // So expect 1 park page for URL_A.
    await waitForParkPages(browser, extensionId, 1, 20000);
    log('  park.html appeared for suspended tabs');

    const tabsAfterSuspend = await queryChromeTabs(browser);
    const parkTabs17 = tabsAfterSuspend.filter(t => t.url && t.url.startsWith(parkPrefix));
    const controlStillActive = tabsAfterSuspend.find(t => t.id === activeTab?.id);

    runner.assert(parkTabs17.length >= 1, `At least 1 tab suspended (got ${parkTabs17.length})`);
    runner.assert(
      controlStillActive != null && !controlStillActive.url.startsWith(parkPrefix),
      'Active (control) tab was NOT suspended',
    );
    log(`  Parked tabs: ${parkTabs17.length}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Unsuspend Current Window (17.3 + 2.10)
    //  Call unsuspendTabs(windowId) — all parked tabs in window should restore.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Unsuspend Current Window (17.3 + 2.10)');

    const parkCountBefore = parkTabs17.length;
    log(`  Calling unsuspendTabs(${windowId})...`);
    await evalInSW(browser, `unsuspendTabs(${windowId})`);

    // Unsuspend has staggered 1-second delays — wait generously
    const waitMs = parkCountBefore * 3000 + 5000;
    log(`  Waiting up to ${waitMs / 1000}s for ${parkCountBefore} tab(s) to restore...`);

    const deadline = Date.now() + waitMs;
    let parkCountAfter = parkCountBefore;
    while (Date.now() < deadline) {
      const currentTabs = await queryChromeTabs(browser);
      parkCountAfter = currentTabs.filter(t => t.url && t.url.startsWith(parkPrefix)).length;
      if (parkCountAfter === 0) break;
      await sleep(1000);
    }

    runner.assert(
      parkCountAfter === 0,
      `All park.html tabs restored after unsuspendTabs() (remaining: ${parkCountAfter})`,
    );

    // Verify example.com is back
    const tabsAfterRestore = await queryChromeTabs(browser);
    const exampleBack = tabsAfterRestore.find(t => t.url && t.url.includes('example.com'));
    runner.softAssert(
      exampleBack != null,
      'example.com tab restored to original URL',
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Suspend Current Tab (17.1)
    //  Make example.com active, then call parkTab(activeTab, activeTab.id).
    //  The ACTIVE tab itself should become parked.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — Suspend Current Tab (17.1)');

    // Navigate to example.com and make it active
    await pageA.bringToFront();
    await sleep(500);

    const activeBeforeSuspend = await getActiveTab(browser);
    log(`  Active tab to suspend: ID=${activeBeforeSuspend?.id} url=${activeBeforeSuspend?.url}`);
    runner.assert(
      activeBeforeSuspend != null && activeBeforeSuspend.url?.includes('example.com'),
      'example.com is the active tab before force-suspend',
    );

    const currentTabId = activeBeforeSuspend!.id;

    // Simulate "Suspend Current Tab" command: parkTab(activeTab, activeTab.id)
    await evalInSW(browser, `(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) parkTab(tabs[0], tabs[0].id);
    })()`);

    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  Active tab suspended — park.html appeared');

    const tabsAfterCurrentSuspend = await queryChromeTabs(browser);
    const currentTabParked = tabsAfterCurrentSuspend.find(
      t => t.id === currentTabId && t.url && t.url.startsWith(parkPrefix),
    );

    runner.assert(
      currentTabParked != null,
      `Tab ${currentTabId} (was active) is now parked`,
    );

  } finally {
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
