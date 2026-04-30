/**
 * Tab Suspender — Suspend / Discard / Session-restore integration test
 *
 * Setup:
 *   cd test/puppeteer && npm install
 *   npm run build   (in project root)
 *
 * Run:
 *   npx tsx suspend-discard.test.ts
 */

/* - Open browser with context
 * - Open 2 tabs
 * - 1. Suspend & Discard 2 tabs
 * - Undiscard 2 tabs
 * - 1.2 Check 2 tabs tab-infos corelation with tab ids
 * - 1.2.1 Check 2 tabs ids corelation with parked tab-ids
 * - 1.3 Spend time for tab-infos cleanup timeout
 * - 1.3.1 Check that tab info cleaned correctly & opened 2 tab-infos stay
 * - >> 1.3.2 Check that count of tabInfos == count of opened tabs
 * - >> 1.3.3 Check for not suspended tab tabInfos are stay and time are correct
 * - 1.4 Check 2 suspended tabs images are loaded
 * - 2. Restart browser with context
 * - 2.1 Spend time for tab-infos cleanup timeout
 * - 2.2 Check 2 tabs tab-infos corelation with tab ids
 * - 2.3 Check 2 tabs ids corelation with parked tab-ids
 * - 2.4 Check for not suspended tab tabInfos are stay and time are correct
 * - 2.5 Check that count of tabInfos == count of opened tabs
 * - 2.6 Check 2 suspended tabs images are loaded
 * - 3 repeat all step 1
 */

import type { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  parkUrlPrefix,
  suspendTabById,
  discardTabById,
  reloadTabById,
  queryChromeTabs,
  getTabInfosCopy,
  forceTabInfoCleanup,
  waitForParkPages,
  getParkPages,
  type CleanupDiagnostics,
} from './base/ExtensionHelper.js';
import { createTestRunner, type TestRunner } from './base/AssertHelper.js';
import type { ChromeTab } from './base/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, '.test-session-sd');
const TARGET_URL = 'https://yandex.com/';

// ─── Page helpers ─────────────────────────────────────────────────────────────

async function openYandexTab(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page
    .goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    .catch(e => log(`  navigate warning: ${(e as Error).message}`));
  return page;
}

// Returns true when img#screen has a non-empty src (screenshot delivered)
async function checkScreenshotLoaded(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const img = document.getElementById('screen') as HTMLImageElement | null;
        return img != null && img.src != null && img.src.length > 200;
      },
      { timeout: 15000 },
    );
    return true;
  } catch {
    return false;
  }
}

// ─── Core check groups ────────────────────────────────────────────────────────

interface CycleResult {
  originalTabBId: number;
  originalTabCId: number;
  parkTabBId: number;
  parkTabCId: number;
}

async function suspendDiscardUndiscard(
  browser: Browser,
  runner: TestRunner,
  cycleLabel: string,
  extensionId: string,
): Promise<CycleResult> {
  const prefix = parkUrlPrefix(extensionId);

  // Open 2 yandex tabs
  runner.section(`${cycleLabel} — Open 2 tabs`);
  await openYandexTab(browser);
  await openYandexTab(browser);
  await sleep(3000);

  const allTabs = await queryChromeTabs(browser);
  const yandexTabs = allTabs.filter(t => t.url?.includes('yandex.com'));
  runner.assert(yandexTabs.length >= 2, `${cycleLabel}: ≥2 yandex.com tabs open`);

  const originalTabBId = yandexTabs[0].id;
  const originalTabCId = yandexTabs[1].id;
  log(`  Tab B id=${originalTabBId}, Tab C id=${originalTabCId}`);

  // 1. Suspend 2 tabs
  runner.section(`${cycleLabel} — 1. Suspend & Discard 2 tabs`);
  log(`  Suspending tab B (${originalTabBId})...`);
  await suspendTabById(browser, originalTabBId);
  log(`  Suspending tab C (${originalTabCId})...`);
  await suspendTabById(browser, originalTabCId);

  await waitForParkPages(browser, extensionId, 2, 30000);

  const afterSuspend = await queryChromeTabs(browser);
  const freshParkTabs = afterSuspend.filter(t => t.url?.startsWith(prefix));
  runner.assert(freshParkTabs.length >= 2, `${cycleLabel}: 2 park pages created`);

  // Use the park tabs that carry the yandex URL in their query string
  const yandexParkTabs = freshParkTabs.filter(
    t => new URL(t.url).searchParams.get('url')?.includes('yandex'),
  );
  runner.assert(yandexParkTabs.length >= 2, `${cycleLabel}: 2 yandex park pages exist`);

  const parkTabBId = yandexParkTabs[0].id;
  const parkTabCId = yandexParkTabs[1].id;
  log(`  Park tab B id=${parkTabBId}, Park tab C id=${parkTabCId}`);

  // Discard the park pages (free their memory)
  log(`  Discarding park tabs...`);
  await discardTabById(browser, parkTabBId);
  await discardTabById(browser, parkTabCId);
  await sleep(2000);

  // Undiscard (reload) the park pages
  log(`  Undiscarding park tabs...`);
  await reloadTabById(browser, parkTabBId);
  await reloadTabById(browser, parkTabCId);
  await sleep(5000); // give park pages time to reload + fetch screenshot

  return { originalTabBId, originalTabCId, parkTabBId, parkTabCId };
}

async function checkTabInfoCorrelation(
  browser: Browser,
  runner: TestRunner,
  label: string,
  parkTabBId: number,
  parkTabCId: number,
): Promise<void> {
  // 1.2 / 2.2 — TabInfo correlation with Chrome tab IDs
  runner.section(`${label} — Tab-infos correlation with tab ids`);
  const tabInfos = await getTabInfosCopy(browser);

  const infoB = tabInfos[String(parkTabBId)];
  const infoC = tabInfos[String(parkTabCId)];

  runner.assert(infoB != null, `${label}: TabInfo exists for park tab B (id=${parkTabBId})`);
  runner.assert(infoC != null, `${label}: TabInfo exists for park tab C (id=${parkTabCId})`);

  if (infoB) {
    runner.assert(infoB._id === parkTabBId, `${label}: TabInfo B._id matches park tab id`);
    runner.assert(infoB._parked === true, `${label}: TabInfo B._parked === true`);
    runner.softAssert(
      infoB._parkedUrl?.includes('yandex') ?? false,
      `${label}: TabInfo B._parkedUrl contains "yandex" (got: ${infoB._parkedUrl})`,
    );
  }
  if (infoC) {
    runner.assert(infoC._id === parkTabCId, `${label}: TabInfo C._id matches park tab id`);
    runner.assert(infoC._parked === true, `${label}: TabInfo C._parked === true`);
    runner.softAssert(
      infoC._parkedUrl?.includes('yandex') ?? false,
      `${label}: TabInfo C._parkedUrl contains "yandex" (got: ${infoC._parkedUrl})`,
    );
  }
}

async function checkParkedTabIds(
  browser: Browser,
  runner: TestRunner,
  label: string,
  extensionId: string,
  parkTabBId: number,
  parkTabCId: number,
): Promise<void> {
  // 1.2.1 / 2.3 — Chrome park tab IDs correlate with TabInfo entries
  runner.section(`${label} — Park tab IDs correlation`);

  const chromeTabs = await queryChromeTabs(browser);
  const prefix = parkUrlPrefix(extensionId);
  const parkChromeTabIds = new Set(
    chromeTabs.filter(t => t.url?.startsWith(prefix)).map(t => t.id),
  );

  runner.assert(
    parkChromeTabIds.has(parkTabBId),
    `${label}: Park tab B (${parkTabBId}) present in Chrome tab list`,
  );
  runner.assert(
    parkChromeTabIds.has(parkTabCId),
    `${label}: Park tab C (${parkTabCId}) present in Chrome tab list`,
  );

  const tabInfos = await getTabInfosCopy(browser);
  const parkedInfoIds = Object.entries(tabInfos)
    .filter(([, info]) => info._parked === true)
    .map(([id]) => Number(id));

  runner.softAssert(
    parkedInfoIds.includes(parkTabBId),
    `${label}: TabInfo with parked=true exists for park B (${parkTabBId})`,
  );
  runner.softAssert(
    parkedInfoIds.includes(parkTabCId),
    `${label}: TabInfo with parked=true exists for park C (${parkTabCId})`,
  );
}

async function waitAndCheckCleanup(
  browser: Browser,
  runner: TestRunner,
  label: string,
  extensionId: string,
  originalTabBId: number,
  originalTabCId: number,
  parkTabBId: number,
  parkTabCId: number,
): Promise<void> {
  // 1.3 / 2.1 — Trigger tab-info cleanup
  runner.section(`${label} — Tab-infos cleanup`);
  log(`  Forcing tab-info cleanup...`);
  const diag = await forceTabInfoCleanup(browser);
  await sleep(1000);

  // Diagnostic logging
  log(`  [DIAG] Chrome tabs at cleanup time (${diag.chromeTabs.length}):`);
  for (const t of diag.chromeTabs) {
    log(`    id=${t.id} discarded=${t.discarded} url=${t.url}`);
  }
  log(`  [DIAG] TabInfos BEFORE cleanup (${Object.keys(diag.tabInfosBefore).length} entries):`);
  for (const [id, info] of Object.entries(diag.tabInfosBefore)) {
    log(`    id=${id} parked=${info._parked} closed=${JSON.stringify(info._closed)} oldRef=${info._oldRefId} newRef=${info._newRefId}`);
  }
  log(`  [DIAG] Marked as closed by cleanup: [${diag.markedAsClosed.join(', ')}]`);
  log(`  [DIAG] TabInfos AFTER cleanup (${Object.keys(diag.tabInfosAfter).length} entries):`);
  for (const [id, info] of Object.entries(diag.tabInfosAfter)) {
    log(`    id=${id} parked=${info._parked} closed=${JSON.stringify(info._closed)} oldRef=${info._oldRefId} newRef=${info._newRefId}`);
  }
  log(`  [DIAG] Expected park B id=${parkTabBId} in after: ${diag.tabInfosAfter[String(parkTabBId)] != null}`);
  log(`  [DIAG] Expected park C id=${parkTabCId} in after: ${diag.tabInfosAfter[String(parkTabCId)] != null}`);

  const tabInfosAfter = await getTabInfosCopy(browser);

  // 1.3.1 — Original tab IDs cleaned, park IDs stay.
  // Skip the "original removed" check when originalId === parkId: in-session suspension
  // navigates the same tab to park.html (same Chrome tab ID, no replacement chain).
  runner.section(`${label} — Post-cleanup state`);
  if (originalTabBId !== parkTabBId) {
    runner.softAssert(
      tabInfosAfter[String(originalTabBId)] == null,
      `${label} 1.3.1: Original tab B (${originalTabBId}) TabInfo removed after cleanup`,
    );
  }
  if (originalTabCId !== parkTabCId) {
    runner.softAssert(
      tabInfosAfter[String(originalTabCId)] == null,
      `${label} 1.3.1: Original tab C (${originalTabCId}) TabInfo removed after cleanup`,
    );
  }
  runner.assert(
    tabInfosAfter[String(parkTabBId)]?._parked === true,
    `${label} 1.3.1: Park tab B TabInfo retained after cleanup`,
  );
  runner.assert(
    tabInfosAfter[String(parkTabCId)]?._parked === true,
    `${label} 1.3.1: Park tab C TabInfo retained after cleanup`,
  );

  // 1.3.2 — count of TabInfos == count of open Chrome tabs
  runner.section(`${label} — TabInfos count == Chrome tabs count`);
  const chromeTabs = await queryChromeTabs(browser);
  const tabInfoCount = Object.keys(tabInfosAfter).length;

  runner.softAssert(
    tabInfoCount === chromeTabs.length,
    `${label} 1.3.2: tabInfos count (${tabInfoCount}) == Chrome tabs (${chromeTabs.length})`,
  );

  // 1.3.3 — Non-suspended tabs still have valid TabInfos
  runner.section(`${label} — Non-suspended tab TabInfos`);
  const prefix = parkUrlPrefix(extensionId);
  const nonParkTabs = chromeTabs.filter(t => !t.url?.startsWith(prefix));

  for (const tab of nonParkTabs) {
    const info = tabInfosAfter[String(tab.id)];
    runner.softAssert(info != null, `${label} 1.3.3: Non-park tab ${tab.id} has TabInfo`);
    if (info) {
      runner.softAssert(
        info._id === tab.id,
        `${label} 1.3.3: TabInfo._id (${info._id}) matches Chrome tab id (${tab.id})`,
      );
      runner.softAssert(
        typeof info._time === 'number' && info._time > 0,
        `${label} 1.3.3: Non-park tab ${tab.id} TabInfo._time is a valid timestamp (got: ${info._time})`,
      );
      runner.softAssert(
        info._parked !== true,
        `${label} 1.3.3: Non-park tab ${tab.id} TabInfo._parked is not true (got: ${info._parked})`,
      );
    }
  }
}

async function checkScreenshots(
  browser: Browser,
  runner: TestRunner,
  label: string,
  extensionId: string,
): Promise<void> {
  // 1.4 / 2.6 — Screenshots loaded on park pages
  runner.section(`${label} — Park page screenshots`);
  const parkPages = await getParkPages(browser, extensionId);
  log(`  Found ${parkPages.length} park pages to check`);

  for (const page of parkPages.slice(0, 2)) {
    const loaded = await checkScreenshotLoaded(page);
    runner.softAssert(
      loaded,
      `${label} 1.4: Screenshot loaded on park page (${page.url().slice(0, 70)}...)`,
    );
  }
}

// ─── Full cycle (steps 1–1.4) ─────────────────────────────────────────────────

async function runFullCycle(
  browser: Browser,
  runner: TestRunner,
  cycleLabel: string,
  extensionId: string,
): Promise<CycleResult> {
  const result = await suspendDiscardUndiscard(browser, runner, cycleLabel, extensionId);
  const { originalTabBId, originalTabCId, parkTabBId, parkTabCId } = result;

  await checkTabInfoCorrelation(browser, runner, `${cycleLabel} 1.2`, parkTabBId, parkTabCId);
  await checkParkedTabIds(browser, runner, `${cycleLabel} 1.2.1`, extensionId, parkTabBId, parkTabCId);
  await waitAndCheckCleanup(
    browser, runner, `${cycleLabel} 1.3`,
    extensionId, originalTabBId, originalTabCId, parkTabBId, parkTabCId,
  );
  await checkScreenshots(browser, runner, `${cycleLabel} 1.4`, extensionId);

  return result;
}

// ─── Close suspended tabs between cycles ─────────────────────────────────────

async function closeParkPages(browser: Browser, extensionId: string): Promise<void> {
  const parkPages = await getParkPages(browser, extensionId);
  log(`  Closing ${parkPages.length} park pages before next cycle...`);
  for (const page of parkPages) {
    await page.close().catch(() => {});
  }
  await sleep(1000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Tab Suspender — Suspend/Discard Integration Test');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  // Clean previous session
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true });
    log('Cleared previous session directory');
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  // ── Phase 1: First browser session ─────────────────────────────────────────
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE 1  Open browser → Run cycle → Save session');
  log('══════════════════════════════════════════════════════');

  const browser1 = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let phase1Result: CycleResult;
  let extensionId: string;

  try {
    extensionId = await getExtensionId(browser1);
    log(`Extension ID: ${extensionId}`);

    // Steps 1–1.4
    phase1Result = await runFullCycle(browser1, runner, 'Cycle-1', extensionId);

    log('\nClosing browser (saving session)...');
    await browser1.close();
    log('Browser closed');
  } catch (e) {
    await browser1.close().catch(() => {});
    throw e;
  }

  // ── Phase 2: Browser restart ────────────────────────────────────────────────
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE 2  Restore session → Verify state');
  log('══════════════════════════════════════════════════════');

  await sleep(3000); // let Chrome finish writing the session

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser reopened with --restore-last-session');

  try {
    log('Waiting 15s for session restore...');
    await sleep(15000);

    const restoredExtensionId = await getExtensionId(browser2);
    runner.assert(
      restoredExtensionId === extensionId,
      `Phase-2: Extension ID unchanged after restart (${restoredExtensionId})`,
    );

    const prefix = parkUrlPrefix(extensionId);

    // After session restore Chrome assigns NEW tab IDs to all restored tabs.
    // Re-discover current park tab IDs; the old Phase-1 IDs are now "stale" entries.
    const chromeTabsOnRestore = await queryChromeTabs(browser2);
    const restoredParkTabs = chromeTabsOnRestore.filter(t => t.url?.startsWith(prefix));
    runner.softAssert(restoredParkTabs.length >= 2, `Phase-2: ≥2 park tabs restored (got ${restoredParkTabs.length})`);

    const newParkTabBId = restoredParkTabs[0]?.id ?? -1;
    const newParkTabCId = restoredParkTabs[1]?.id ?? -1;
    log(`  Restored park tab IDs: B=${newParkTabBId}, C=${newParkTabCId}`);
    log(`  Phase-1 park tab IDs (now stale): B=${phase1Result.parkTabBId}, C=${phase1Result.parkTabCId}`);

    // 2.1 — Cleanup after restart.
    // "stale" = Phase-1 park IDs that are no longer in Chrome's tab list.
    // "current" = freshly restored park IDs that should remain.
    await waitAndCheckCleanup(
      browser2, runner, '2.1',
      extensionId,
      phase1Result.parkTabBId, phase1Result.parkTabCId, // stale → should be cleaned
      newParkTabBId, newParkTabCId,                      // current → should remain
    );

    // 2.2 — TabInfo correlation after restart (use new IDs)
    await checkTabInfoCorrelation(browser2, runner, '2.2', newParkTabBId, newParkTabCId);

    // 2.3 — Parked tab IDs after restart (use new IDs)
    await checkParkedTabIds(browser2, runner, '2.3', extensionId, newParkTabBId, newParkTabCId);

    // 2.4 — Non-suspended tab infos after restart
    runner.section('2.4 — Non-suspended tab TabInfos after restart');
    const tabInfosAfterRestart = await getTabInfosCopy(browser2);
    const chromeTabsAfterRestart = await queryChromeTabs(browser2);
    const nonParkTabsAfterRestart = chromeTabsAfterRestart.filter(t => !t.url?.startsWith(prefix));
    for (const tab of nonParkTabsAfterRestart) {
      const info = tabInfosAfterRestart[String(tab.id)];
      runner.softAssert(info != null, `2.4: Non-park tab ${tab.id} has TabInfo after restart`);
      if (info) {
        runner.softAssert(info._id === tab.id, `2.4: TabInfo._id matches Chrome tab id (${tab.id})`);
        runner.softAssert(
          typeof info._time === 'number' && info._time > 0,
          `2.4: Non-park tab ${tab.id} TabInfo._time is a valid timestamp (got: ${info._time})`,
        );
        runner.softAssert(
          info._parked !== true,
          `2.4: Non-park tab ${tab.id} TabInfo._parked is not true (got: ${info._parked})`,
        );
      }
    }

    // 2.5 — Count match after restart
    runner.section('2.5 — TabInfos count == Chrome tabs count after restart');
    const tabInfoCountAfterRestart = Object.keys(tabInfosAfterRestart).length;
    runner.softAssert(
      tabInfoCountAfterRestart === chromeTabsAfterRestart.length,
      `2.5: tabInfos (${tabInfoCountAfterRestart}) == Chrome tabs (${chromeTabsAfterRestart.length})`,
    );

    // 2.6 — Screenshots after restart.
    // park.ts sends [TS:getScreen] with a 2.5s timeout on first load.  After a cold
    // restart the extension DB may not be ready within 2.5s, so screenshots are
    // silently skipped even though they ARE stored in IndexedDB.
    // Fix: reload park pages now that the DB is guaranteed to be initialized,
    // triggering a fresh screenshot fetch that will succeed.
    runner.section('2.6 — Park page screenshots after restart');
    log('  Reloading park pages (DB now initialized, re-triggering screenshot fetch)...');
    await reloadTabById(browser2, newParkTabBId);
    await reloadTabById(browser2, newParkTabCId);
    await sleep(5000);
    await checkScreenshots(browser2, runner, '2.6', extensionId);

    // ── Phase 3: Repeat cycle (step 3 in test plan) ─────────────────────────
    log('\n══════════════════════════════════════════════════════');
    log('  PHASE 3  Repeat cycle 1 in the same browser session');
    log('══════════════════════════════════════════════════════');

    await closeParkPages(browser2, extensionId);
    await runFullCycle(browser2, runner, 'Cycle-2', extensionId);

    await browser2.close();
  } catch (e) {
    await browser2.close().catch(() => {});
    throw e;
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
