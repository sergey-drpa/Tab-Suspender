/**
 * Tab Suspender — autoRestoreTab E2E Test
 *
 * Covers test case 2.2:
 *   When autoRestoreTab=true, activating a suspended tab must immediately
 *   trigger automatic restoration to the original URL without any user click.
 *
 * Flow:
 *   Phase A — Enable autoRestoreTab=true.
 *   Phase B — Open a real page, suspend it via force-park, verify park.html.
 *   Phase C — Bring the park.html page to the front (simulate user clicking the tab).
 *             The extension's onActivated listener fires → unsuspendTab() is called
 *             automatically → tab navigates to original URL.
 *   Phase D — Restore default: set autoRestoreTab back to false.
 *
 * Run:
 *   cd test/puppeteer && npx tsx auto-restore-tab.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  suspendTabById,
  waitForParkPages,
  getParkPages,
  queryChromeTabs,
  getSetting,
  setSetting,
  waitForTabToRestore,
  waitForAnyTabToLeaveParked,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-auto-restore');
const TARGET_URL  = 'https://example.com/';

async function main(): Promise<void> {
  log('Tab Suspender — autoRestoreTab');
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
    //  PHASE A — Enable autoRestoreTab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Enable autoRestoreTab');

    const originalValue = await getSetting(browser, 'autoRestoreTab');
    log(`  autoRestoreTab before: ${originalValue}`);

    await setSetting(browser, 'autoRestoreTab', true);
    const valueAfter = await getSetting(browser, 'autoRestoreTab');
    runner.assert(valueAfter === true, `autoRestoreTab set to true (got: ${valueAfter})`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Open page and suspend it
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Open page and suspend it');

    const targetPage = await browser.newPage();
    await targetPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(1500);

    const tabs = await queryChromeTabs(browser);
    const targetTab = tabs.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetTab != null, 'example.com tab exists');

    const tabId = targetTab!.id;

    // Move focus away so the tab is inactive before suspension
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(300);

    log(`  Force-suspending tab ${tabId}...`);
    await suspendTabById(browser, tabId);
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  park.html appeared');

    const parkPages = await getParkPages(browser, extensionId);
    runner.assert(parkPages.length >= 1, 'At least one park.html page visible');

    const parkPage = parkPages[0];
    // Get the park.html tab's Chrome tab ID from the URL params
    const parkPageUrl = parkPage.url();
    const parkedTabIdMatch = parkPageUrl.match(/[?&]tabId=(\d+)/);
    const parkedTabId = parkedTabIdMatch ? parseInt(parkedTabIdMatch[1]) : null;
    log(`  park.html URL: ${parkPageUrl.slice(0, 100)}`);
    log(`  original tabId from URL params: ${parkedTabId}`);

    // Get the actual Chrome tab ID of the park.html tab
    const allTabs = await queryChromeTabs(browser);
    const parkTab = allTabs.find(t => t.url && t.url.startsWith(parkUrlPrefix(extensionId)));
    runner.assert(parkTab != null, 'park.html tab found in chrome tabs');

    const parkTabId = parkTab!.id;
    log(`  park.html Chrome tab ID: ${parkTabId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Activate the park.html tab → autoRestoreTab fires
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — Activate park tab → auto-restore fires');

    // bringToFront() triggers Chrome's tab activation event
    await parkPage.bringToFront();
    log('  park.html brought to front (activation event fired)');

    // The extension's onActivated listener should now call unsuspendTab automatically
    const restoredUrl = await waitForAnyTabToLeaveParked(
      browser,
      extensionId,
      'example.com',
      20000,
    ).catch(async () => {
      // Fallback: check by tab ID
      return waitForTabToRestore(browser, parkTabId, 20000).catch(() => null);
    });

    runner.assert(
      typeof restoredUrl === 'string' && restoredUrl != null && restoredUrl.includes('example.com'),
      `Tab auto-restored to example.com (got: ${restoredUrl})`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE D — Restore setting
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase D — Restore autoRestoreTab to original value');

    await setSetting(browser, 'autoRestoreTab', originalValue ?? false);
    const restored = await getSetting(browser, 'autoRestoreTab');
    runner.softAssert(
      restored === (originalValue ?? false),
      `autoRestoreTab restored to ${originalValue ?? false} (got: ${restored})`,
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
