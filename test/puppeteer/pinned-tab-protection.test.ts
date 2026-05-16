/**
 * Tab Suspender — Pinned Tab Protection E2E Test
 *
 * Covers test cases 5.1 and 5.2:
 *   5.1 — pinned=true setting: the extension resets tabInfo.time to 0 at the
 *         END of every tick for pinned tabs. With timeout=20s and tickSize=10s,
 *         each tick adds 10 (below 20) then resets to 0 — threshold never reached.
 *   5.2 — pinned=false setting: pinned tabs receive no special treatment;
 *         time accumulates normally and the tab is auto-suspended.
 *
 * Mechanism (TabObserver.tick, after all suspension checks):
 *   if (pinnedSettings && tab.pinned) tabInfo.time = 0;
 *   With timeout > tickSize (20 > 10) the per-tick increment never reaches
 *   the threshold before the reset clears it.
 *
 * Run:
 *   cd test/puppeteer && npx tsx pinned-tab-protection.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  queryChromeTabs,
  getTabInfosCopy,
  parkUrlPrefix,
  getSetting,
  setSetting,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-pinned');
const TARGET_URL  = 'https://example.com/';

// timeout=20 > tickSize=10: one tick adds 10 (below threshold) → with pinned
// protection the counter resets to 0 and never reaches 20. Without protection,
// two ticks add 20 which equals the threshold and suspension fires.
const TEST_TIMEOUT = 20;

async function closeExtensionTabs(browser: Awaited<ReturnType<typeof launchBrowser>>, extensionId: string) {
  const tabs = await queryChromeTabs(browser);
  for (const t of tabs) {
    if (t.url?.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html')) {
      await evalInSW(browser, `chrome.tabs.remove(${t.id})`).catch(() => {});
    }
  }
  await sleep(300);
}

async function main(): Promise<void> {
  log('Tab Suspender — Pinned Tab Protection');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let originalPinned: unknown   = null;
  let originalTimeout: unknown  = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);
    await waitForExtensionInit(browser);

    originalPinned  = await getSetting(browser, 'pinned');
    originalTimeout = await getSetting(browser, 'timeout');
    const parkPrefix = parkUrlPrefix(extensionId);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — pinned=true: pinned tab is protected, never auto-suspended
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — pinned=true: pinned tab NOT auto-suspended (5.1)');

    await closeExtensionTabs(browser, extensionId);
    await setSetting(browser, 'pinned', true);
    await setSetting(browser, 'timeout', TEST_TIMEOUT);
    log(`  Settings: pinned=true, timeout=${TEST_TIMEOUT}s`);

    const pageA = await browser.newPage();
    await pageA.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav: ${(e as Error).message}`));
    await sleep(1500);

    const tabsA = await queryChromeTabs(browser);
    const targetA = tabsA.find(t => t.url?.includes('example.com'));
    runner.assert(targetA != null, 'example.com tab found for Phase A');
    const tabIdA = targetA!.id;

    // Pin the tab so the protection logic applies
    await evalInSW(browser, `chrome.tabs.update(${tabIdA}, { pinned: true })`);
    await sleep(300);
    log(`  Tab ${tabIdA} pinned`);

    // Move focus away — starts inactivity accumulation
    const blankA = await browser.newPage();
    await blankA.goto('about:blank');
    await sleep(500);

    // Wait 35s: 3 full ticks of 10s each.
    // Without protection time would reach 20 (threshold) at tick 2 and be suspended.
    log('  Waiting 35s (3+ ticks) — expect NO suspension with pinned=true...');
    await sleep(35000);

    const tabsAfterA = await queryChromeTabs(browser);
    const stillLiveA = tabsAfterA.find(t => t.id === tabIdA);
    const notParkedA = stillLiveA?.url != null && !stillLiveA.url.startsWith(parkPrefix);

    log(`  Tab ${tabIdA} URL after 35s: ${stillLiveA?.url?.slice(0, 80)}`);
    runner.assert(notParkedA === true, 'Pinned tab (pinned=true) NOT auto-suspended after 35s');

    const tabInfosA = await getTabInfosCopy(browser);
    const infoA = tabInfosA[String(tabIdA)];
    log(`  tabInfo._time = ${infoA?._time}`);
    runner.softAssert(
      infoA == null || (infoA._time as number) < TEST_TIMEOUT,
      `tabInfo._time (${infoA?._time}) < threshold (${TEST_TIMEOUT}) — reset by pinned protection`,
    );

    // Clean up Phase A
    await evalInSW(browser, `chrome.tabs.update(${tabIdA}, { pinned: false })`).catch(() => {});
    await pageA.close().catch(() => {});
    await blankA.close().catch(() => {});
    await sleep(300);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — pinned=false: pinned tab has no timer protection, IS suspended
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — pinned=false: pinned tab IS auto-suspended (5.2)');

    await closeExtensionTabs(browser, extensionId);
    await setSetting(browser, 'pinned', false);
    await setSetting(browser, 'timeout', TEST_TIMEOUT);
    log(`  Settings: pinned=false, timeout=${TEST_TIMEOUT}s`);

    const pageB = await browser.newPage();
    await pageB.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav: ${(e as Error).message}`));
    await sleep(1500);

    const tabsB = await queryChromeTabs(browser);
    const targetB = tabsB.find(t => t.url?.includes('example.com'));
    runner.assert(targetB != null, 'example.com tab found for Phase B');
    const tabIdB = targetB!.id;

    // Pin the tab — but setting pinned=false means no protection
    await evalInSW(browser, `chrome.tabs.update(${tabIdB}, { pinned: true })`);
    await sleep(300);
    log(`  Tab ${tabIdB} pinned (but pinned setting is false — no protection)`);

    // Move focus away
    const blankB = await browser.newPage();
    await blankB.goto('about:blank');
    await sleep(500);

    log(`  Waiting for pinned tab ${tabIdB} to be auto-suspended...`);
    const deadline = Date.now() + 40000;
    let suspendedB = false;
    while (Date.now() < deadline) {
      const json = await evalInSW<string>(browser, `(async () => {
        const t = await chrome.tabs.get(${tabIdB}).catch(() => null);
        return JSON.stringify(t ? { url: t.url } : null);
      })()`);
      if (json) {
        const t = JSON.parse(json) as { url: string } | null;
        if (t?.url?.startsWith(parkPrefix)) { suspendedB = true; break; }
      }
      await sleep(1000);
    }

    log(`  Tab ${tabIdB} suspended: ${suspendedB}`);
    runner.assert(suspendedB, 'Pinned tab (pinned=false) IS auto-suspended by timer');

    await blankB.close().catch(() => {});

  } finally {
    if (originalPinned != null)
      await setSetting(browser, 'pinned', originalPinned).catch(() => {});
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
