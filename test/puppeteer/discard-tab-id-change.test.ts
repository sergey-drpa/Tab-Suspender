/**
 * Tab Suspender — Discard + Restore (Tab ID Change) E2E Test
 *
 * Covers test cases 9.4 and 13.4:
 *   9.4  — A discarded park.html tab, when activated, correctly navigates to original URL.
 *   13.4 — After chrome.tabs.discard() the park.html tab is in a discarded state;
 *           calling unsuspendTab on it must still work (it reloads first, then restores).
 *
 * Background on ID change:
 *   chrome.tabs.discard() keeps the same tab ID on most Chrome versions.
 *   Chrome may internally reassign the ID via chrome.tabs.onReplaced when the tab
 *   is natively frozen/frozen, but this is rare. The extension handles both cases.
 *   This test verifies the end-to-end flow: suspend → discard → restore.
 *
 * Flow:
 *   Phase A — Open a page and force-suspend it (tab becomes park.html).
 *   Phase B — Discard the park.html tab via chrome.tabs.discard().
 *             Verify the tab is now discarded.
 *   Phase C — Call tabManager.unsuspendTab on the discarded park.html tab.
 *             unsuspendTab detects tab.discarded=true → calls markForUnsuspend + reload.
 *             On reload the park.html fires the marked-for-unsuspend logic and
 *             navigates to the original URL.
 *   Phase D — Verify the tab is back at the original URL.
 *
 * Run:
 *   cd test/puppeteer && npx tsx discard-tab-id-change.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  discardTabById,
  unsuspendTabById,
  waitForParkPages,
  queryChromeTabs,
  waitForAnyTabToLeaveParked,
  waitForTabToRestore,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-discard-restore');
const TARGET_URL  = 'https://example.com/';

async function main(): Promise<void> {
  log('Tab Suspender — Discard + Restore (Tab ID Change)');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Open page and suspend it
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Suspend tab');

    const targetPage = await browser.newPage();
    await targetPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(1500);

    const tabs = await queryChromeTabs(browser);
    const targetTab = tabs.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetTab != null, 'example.com tab found');

    const tabId = targetTab!.id;

    // Move focus away — tab must be inactive to park
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(300);

    log(`  Force-suspending tab ${tabId}...`);
    await suspendTabById(browser, tabId);
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  park.html appeared');

    const tabsAfterSuspend = await queryChromeTabs(browser);
    const parkPrefix = parkUrlPrefix(extensionId);
    const parkTab = tabsAfterSuspend.find(t => t.url && t.url.startsWith(parkPrefix));
    runner.assert(parkTab != null, 'park.html tab exists after suspend');

    const parkTabId = parkTab!.id;
    log(`  park.html tab ID: ${parkTabId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Discard the park.html tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Discard park.html tab');

    await discardTabById(browser, parkTabId);
    log('  chrome.tabs.discard() called');
    await sleep(2000);

    const tabsAfterDiscard = await queryChromeTabs(browser);
    // After discard, the tab URL remains park.html but discarded=true
    const discardedTab = tabsAfterDiscard.find(
      t => t.id === parkTabId && t.url && t.url.startsWith(parkPrefix),
    );

    runner.softAssert(
      discardedTab != null && discardedTab.discarded === true,
      `park.html tab is discarded (discarded=${discardedTab?.discarded}, found=${discardedTab != null})`,
    );

    // Use the current tab ID (may be same or new after discard)
    const currentParkTab = tabsAfterDiscard.find(t => t.url && t.url.startsWith(parkPrefix)) ?? discardedTab;
    const currentParkTabId = currentParkTab?.id ?? parkTabId;
    log(`  Current park tab ID after discard: ${currentParkTabId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Unsuspend the discarded park.html tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — Restore discarded park.html tab');

    log(`  Calling unsuspendTab on discarded tab ${currentParkTabId}...`);
    await unsuspendTabById(browser, currentParkTabId);
    // unsuspendTab detects discarded=true → calls markForUnsuspend + chrome.tabs.reload()
    // The reload triggers park.html to check isTabMarkedForUnsuspend and navigate back
    log('  unsuspendTab called — waiting for restore...');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE D — Verify original URL restored
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase D — Verify original URL restored');

    const restoredUrl = await waitForAnyTabToLeaveParked(
      browser,
      extensionId,
      'example.com',
      25000,
    ).catch(async () => {
      return waitForTabToRestore(browser, currentParkTabId, 25000).catch(() => null);
    });

    runner.assert(
      typeof restoredUrl === 'string' && restoredUrl != null && restoredUrl.includes('example.com'),
      `Tab restored to example.com after discard+unsuspend (got: ${restoredUrl})`,
    );

    log(`  Restored URL: ${restoredUrl}`);

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
