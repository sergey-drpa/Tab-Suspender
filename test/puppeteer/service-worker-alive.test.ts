/**
 * Tab Suspender — Service Worker Alive E2E Test
 *
 * Covers test case:
 *   16.2 — Service worker does not sleep during active use
 *
 * Chrome MV3 terminates idle service workers after ~30 seconds.
 * Tab Suspender keeps the SW alive with a heartbeat message sent from the
 * offscreen document every 20 seconds.
 *
 * This test:
 *   1. Records TSSessionId (set to Date.now() at SW startup — changes if SW restarts).
 *   2. Opens tabs and parks one to create meaningful SW state.
 *   3. Waits 25 seconds with no CDP activity (heartbeat fires at 20 s).
 *   4. Verifies TSSessionId is unchanged (SW was not restarted / reinitialized).
 *   5. Verifies tabManager state is still intact.
 *   6. Makes one more evalInSW call to confirm the SW responds normally.
 *
 * Run:
 *   cd test/puppeteer && npx tsx service-worker-alive.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  waitForExtensionInit,
  queryChromeTabs,
  parkUrlPrefix,
  waitForParkPages,
  suspendTabById,
  getSetting,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-sw-alive');

async function main(): Promise<void> {
  log('Tab Suspender — Service Worker Alive (16.2)');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);
    log('Extension initialized');

    const parkPrefix = parkUrlPrefix(extensionId);

    // ── Phase 1: Record initial SW state ──────────────────────────────────────
    runner.section('Phase 1 — Record initial service worker state');

    const tsSessionId1 = await evalInSW<number>(browser, 'TSSessionId');
    runner.assert(
      typeof tsSessionId1 === 'number' && tsSessionId1 > 0,
      `TSSessionId is a valid number at startup (got: ${tsSessionId1})`,
    );
    log(`  TSSessionId at startup: ${tsSessionId1}`);

    runner.assert(
      await evalInSW<boolean>(browser, 'typeof tabManager !== "undefined" && typeof settings !== "undefined"'),
      'SW globals (tabManager, settings) are available at startup',
    );

    // ── Phase 2: Open and suspend a real HTTPS tab ────────────────────────────
    runner.section('Phase 2 — Open and suspend an HTTPS tab to create SW state');

    const page = await browser.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  navigate warning: ${(e as Error).message}`));
    await sleep(1500);

    const allTabs = await queryChromeTabs(browser);
    const exTab = allTabs.find(t => t.url?.startsWith('https://example.com'));
    runner.assert(exTab != null, 'example.com tab is open');
    const exTabId = exTab!.id;
    log(`  example.com tab id=${exTabId}`);

    await suspendTabById(browser, exTabId);

    // Wait up to 15 s for the park page to appear
    await waitForParkPages(browser, extensionId, 1, 15000);

    const tabsAfterPark = await queryChromeTabs(browser);
    const parkTabs = tabsAfterPark.filter(t => t.url?.startsWith(parkPrefix));
    runner.assert(parkTabs.length >= 1, `Park tab appeared after suspension (got ${parkTabs.length})`);

    const parkTabId = parkTabs[0].id;
    log(`  Park tab id=${parkTabId}`);

    // Verify tabManager tracks the parked tab
    const tabInfosBeforeJson = await evalInSW<string>(browser, 'JSON.stringify(tabManager.getTabInfosCopy())');
    const tabInfosBefore = JSON.parse(tabInfosBeforeJson) as Record<string, { _parked?: boolean }>;
    runner.assert(
      tabInfosBefore[String(parkTabId)]?._parked === true,
      `TabInfo for park tab ${parkTabId} has _parked=true`,
    );

    // ── Phase 3: Wait 25 s with no CDP activity ───────────────────────────────
    // The heartbeat fires at 20 s. Chrome would normally terminate an idle MV3
    // service worker after ~30 s. The heartbeat must keep it alive.
    runner.section('Phase 3 — Waiting 25 s (heartbeat expected at ~20 s)');
    log('  Sleeping 25 seconds...');
    await sleep(25000);
    log('  Sleep complete — verifying SW is still alive');

    // ── Phase 4: Verify SW is still alive and state preserved ─────────────────
    runner.section('Phase 4 — Verify SW alive and state preserved after 25 s');

    const tsSessionId2 = await evalInSW<number>(browser, 'TSSessionId');
    runner.assert(
      tsSessionId2 === tsSessionId1,
      `TSSessionId unchanged — SW was NOT restarted (before: ${tsSessionId1}, after: ${tsSessionId2})`,
    );

    runner.assert(
      await evalInSW<boolean>(browser, 'typeof tabManager !== "undefined" && typeof settings !== "undefined"'),
      'SW globals still accessible after 25 s',
    );

    // Parked tab must still be tracked
    const tabInfosAfterJson = await evalInSW<string>(browser, 'JSON.stringify(tabManager.getTabInfosCopy())');
    const tabInfosAfter = JSON.parse(tabInfosAfterJson) as Record<string, { _parked?: boolean }>;
    runner.assert(
      tabInfosAfter[String(parkTabId)]?._parked === true,
      `TabInfo for park tab ${parkTabId} still present with _parked=true after 25 s`,
    );

    // Park tab must still be in Chrome's tab list
    const tabsAfterWait = await queryChromeTabs(browser);
    const parkTabsAfterWait = tabsAfterWait.filter(t => t.url?.startsWith(parkPrefix));
    runner.assert(
      parkTabsAfterWait.length >= 1,
      `Park tab still in Chrome tab list after 25 s (found ${parkTabsAfterWait.length})`,
    );

    // settings.get() still works — confirms the SW is fully responsive
    const activeAfterWait = await getSetting(browser, 'active');
    runner.assert(
      typeof activeAfterWait === 'boolean',
      `settings.get("active") returns a boolean after 25 s (got: ${activeAfterWait})`,
    );

    log(`\n  SW state after 25 s: TSSessionId=${tsSessionId2}, active=${activeAfterWait}`);

  } finally {
    await browser.close();
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
