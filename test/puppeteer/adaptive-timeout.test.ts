/**
 * Tab Suspender — Adaptive Timeout E2E Test
 *
 * Covers test case 1.8:
 *   adaptiveSuspendTimeout=true → tabs with higher visit frequency (swch_cnt)
 *   receive a longer effective timeout before auto-suspension.
 *
 * Formula (TabObserver.tick ~line 220):
 *   calculatedTabTimeFrame =
 *       timeout
 *     + timeout × parkedCount
 *     + (active_time + 1) × log₂(swch_cnt + 1)
 *     + (timeout / 4) × log₂(swch_cnt + 1)
 *
 * Test parameters: timeout=10, swch_cnt=7, active_time=0, parkedCount=0
 *   log₂(8) = 3
 *   calculatedTabTimeFrame = 10 + 0 + 1×3 + 2.5×3 = 20.5 s
 *
 * Phase A — adaptiveSuspendTimeout=false (baseline):
 *   swch_cnt=7 is ignored; tab suspended at tick 1 (time=10 ≥ timeout=10).
 *
 * Phase B — adaptiveSuspendTimeout=true:
 *   tick 1: time=10 < 20.5 → NOT suspended
 *   tick 2: time=20 < 20.5 → NOT suspended
 *   tick 3: time=30 ≥ 20.5 → SUSPENDED
 *
 * swch_cnt, active_time, and parkedCount are set directly on TabInfo via
 * evalInSW after the tab is registered as inactive, giving deterministic
 * formula results.
 *
 * Run:
 *   cd test/puppeteer && npx tsx adaptive-timeout.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Page } from 'puppeteer';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  queryChromeTabs,
  parkUrlPrefix,
  getSetting,
  setSetting,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-adaptive-timeout');
const TARGET_URL  = 'https://example.com/';

// swch_cnt=7 → log₂(8)=3
// calculatedTabTimeFrame = 10 + 0 + 1×3 + 2.5×3 = 20.5 s
const TEST_TIMEOUT   = 10;
const TEST_SWCH_CNT  = 7;

async function closeExtensionTabs(browser: Awaited<ReturnType<typeof launchBrowser>>, extensionId: string) {
  const tabs = await queryChromeTabs(browser);
  for (const t of tabs) {
    if (t.url?.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html')) {
      await evalInSW(browser, `chrome.tabs.remove(${t.id})`).catch(() => {});
    }
  }
  await sleep(300);
}

// Open example.com, move focus to blank, pin deterministic tabInfo values.
// Returns the page, blank page, and Chrome tab ID.
async function openAndSetup(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
): Promise<{ page: Page; blank: Page; tabId: number }> {
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    .catch(e => log(`  nav: ${(e as Error).message}`));
  await sleep(1500);

  const tabs = await queryChromeTabs(browser);
  // Use exact-URL match so park.html tabs (whose URLs contain 'example.com'
  // as an encoded query parameter) are not mistakenly selected.
  const target = tabs.find(t => t.url === TARGET_URL);
  if (!target) throw new Error(`No tab at exactly ${TARGET_URL}`);
  const tabId = target.id;

  // Move focus away → tab becomes inactive
  const blank = await browser.newPage();
  await blank.goto('about:blank');
  await sleep(500);

  // Zero-out tabInfo fields that affect the adaptive formula so results
  // are deterministic regardless of prior test state.
  await evalInSW(browser, `(function() {
    const info = tabManager.getTabInfoById(${tabId});
    if (info) {
      info._swch_cnt    = ${TEST_SWCH_CNT};
      info._active_time = 0;
      info._parkedCount = 0;
      info._time        = 0;
    }
  })()`);

  const actual = await evalInSW<string>(browser, `(function() {
    const info = tabManager.getTabInfoById(${tabId});
    return JSON.stringify(info
      ? { swch_cnt: info._swch_cnt, active_time: info._active_time, parkedCount: info._parkedCount, time: info._time }
      : null);
  })()`);
  log(`  TabInfo after reset: ${actual}`);

  return { page, blank, tabId };
}

async function main(): Promise<void> {
  log('Tab Suspender — Adaptive Timeout');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let originalAdaptive: unknown = null;
  let originalTimeout: unknown  = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);
    await waitForExtensionInit(browser);

    originalAdaptive = await getSetting(browser, 'adaptiveSuspendTimeout');
    originalTimeout  = await getSetting(browser, 'timeout');
    const parkPrefix = parkUrlPrefix(extensionId);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — adaptiveSuspendTimeout=false (baseline)
    //  swch_cnt=7 is irrelevant; non-adaptive checks time ≥ timeout only.
    //  Expected: suspended at tick 1 (time=10 ≥ timeout=10).
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — adaptiveSuspendTimeout=false: suspended at tick 1 (baseline)');

    await closeExtensionTabs(browser, extensionId);
    await setSetting(browser, 'adaptiveSuspendTimeout', false);
    await setSetting(browser, 'timeout', TEST_TIMEOUT);

    const { page: pageA, blank: blankA, tabId: tabIdA } = await openAndSetup(browser);
    log(`  Waiting for tab ${tabIdA} (non-adaptive, timeout=${TEST_TIMEOUT}s)...`);

    const deadlineA = Date.now() + 35000;
    let suspendedA = false;
    while (Date.now() < deadlineA) {
      const json = await evalInSW<string>(browser, `(async () => {
        const t = await chrome.tabs.get(${tabIdA}).catch(() => null);
        return JSON.stringify(t ? { url: t.url } : null);
      })()`);
      if (json) {
        const t = JSON.parse(json) as { url: string } | null;
        if (t?.url?.startsWith(parkPrefix)) { suspendedA = true; break; }
      }
      await sleep(1000);
    }

    log(`  Tab ${tabIdA} suspended: ${suspendedA}`);
    runner.assert(suspendedA, `Non-adaptive: suspended when time ≥ timeout=${TEST_TIMEOUT}s (swch_cnt ignored)`);

    await pageA.close().catch(() => {});
    await blankA.close().catch(() => {});
    await sleep(500);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — adaptiveSuspendTimeout=true
    //  With swch_cnt=7, active_time=0, parkedCount=0:
    //    calculatedTabTimeFrame = 10 + 0 + 1×3 + 2.5×3 = 20.5 s
    //  tick 1 (time=10): 10 < 20.5 → NOT suspended  ✓
    //  tick 2 (time=20): 20 < 20.5 → NOT suspended  ✓
    //  tick 3 (time=30): 30 ≥ 20.5 → SUSPENDED      ✓
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — adaptiveSuspendTimeout=true: suspension delayed to 3rd tick (1.8)');

    await closeExtensionTabs(browser, extensionId);
    await setSetting(browser, 'adaptiveSuspendTimeout', true);
    await setSetting(browser, 'timeout', TEST_TIMEOUT);

    const { page: pageB, blank: blankB, tabId: tabIdB } = await openAndSetup(browser);

    // ── Tick 1 check: 12s from now, tab must NOT be suspended (time=10 < 20.5) ──
    log('  Waiting ~12s past tick 1 — tab must NOT be suspended yet...');
    await sleep(12000);

    const urlAfterTick1 = await evalInSW<string>(browser, `(async () => {
      const t = await chrome.tabs.get(${tabIdB}).catch(() => null);
      return t ? t.url : null;
    })()`);
    log(`  Tab ${tabIdB} URL after tick 1: ${urlAfterTick1?.slice(0, 80)}`);
    runner.assert(
      urlAfterTick1 != null && !urlAfterTick1.startsWith(parkPrefix),
      `Adaptive: tab NOT suspended at tick 1 (time=10 < calculatedTabTimeFrame≈20.5)`,
    );

    // ── Tick 2 check: another 12s, tab still must NOT be suspended (time=20 < 20.5) ──
    log('  Waiting another ~12s past tick 2 — tab must still NOT be suspended...');
    await sleep(12000);

    const urlAfterTick2 = await evalInSW<string>(browser, `(async () => {
      const t = await chrome.tabs.get(${tabIdB}).catch(() => null);
      return t ? t.url : null;
    })()`);
    log(`  Tab ${tabIdB} URL after tick 2: ${urlAfterTick2?.slice(0, 80)}`);
    runner.softAssert(
      urlAfterTick2 != null && !urlAfterTick2.startsWith(parkPrefix),
      `Adaptive: tab NOT suspended at tick 2 (time=20 < calculatedTabTimeFrame≈20.5)`,
    );

    // ── Tick 3: time=30 ≥ 20.5 → tab should be suspended ──
    log('  Waiting for tick 3 — tab SHOULD be suspended (time=30 ≥ 20.5)...');
    const deadlineB = Date.now() + 20000;
    let suspendedB = false;
    while (Date.now() < deadlineB) {
      const url = await evalInSW<string>(browser, `(async () => {
        const t = await chrome.tabs.get(${tabIdB}).catch(() => null);
        return t ? t.url : null;
      })()`);
      if (url?.startsWith(parkPrefix)) { suspendedB = true; break; }
      await sleep(1000);
    }

    log(`  Tab ${tabIdB} suspended at tick 3: ${suspendedB}`);
    runner.assert(suspendedB, `Adaptive: tab suspended at tick 3 (time=30 ≥ calculatedTabTimeFrame≈20.5)`);

    await pageB.close().catch(() => {});
    await blankB.close().catch(() => {});

  } finally {
    if (originalAdaptive != null)
      await setSetting(browser, 'adaptiveSuspendTimeout', originalAdaptive).catch(() => {});
    if (originalTimeout != null)
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
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
