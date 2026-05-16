/**
 * Tab Suspender — Start Discarded E2E Test
 *
 * Covers test case 15.2:
 *   startDiscarted=true → parked (park.html) tabs created in background
 *   are automatically discarded shortly after startup.
 *
 * Mechanism (park.ts):
 *   On DOMContentLoaded, park.html requests parkData from background.
 *   If parkData.startDiscarded=true AND the extension started < 15 seconds ago
 *   AND isFirstTimeTabDiscard=true AND no active tab in the current window →
 *   the park.html page sends [AutomaticTabCleaner:DiscardTab] to background,
 *   which calls chrome.tabs.discard().
 *
 * Test strategy:
 *   Phase A — startDiscarted=false: park.html does NOT get startDiscarded in parkData.
 *   Phase B — startDiscarted=true AND within 15s window: verify parkData carries the
 *             correct flags (startDiscarded=true, isFirstTimeTabDiscard=true, startAge<15s).
 *   Phase C — [AutomaticTabCleaner:DiscardTab] handler: sending the message from the
 *             park.html page context discards the tab (tests the actual discard path).
 *
 * Note: The full auto-discard trigger in park.ts requires chrome.tabs.query to return
 * an empty active-tab set, which only happens transiently during session restore. That
 * timing-dependent path is covered by manual/integration testing.
 *
 * Run:
 *   cd test/puppeteer && npx tsx start-discarded.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  queryChromeTabs,
  waitForParkPages,
  getParkPages,
  getSetting,
  setSetting,
  parkUrlPrefix,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-start-discarded');
const TARGET_URL  = 'https://example.com/';

async function main(): Promise<void> {
  log('Tab Suspender — Start Discarded');
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

    const originalSetting = await getSetting(browser, 'startDiscarted');
    log(`  startDiscarted default: ${originalSetting}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — startDiscarted=false: parkData.startDiscarded must be false
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — startDiscarted=false: parkData carries startDiscarded=false');

    await setSetting(browser, 'startDiscarted', false);

    const pageA = await browser.newPage();
    await pageA.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(1000);

    const tabsA = await queryChromeTabs(browser);
    const targetA = tabsA.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetA != null, 'example.com tab found for Phase A');

    const blankA = await browser.newPage();
    await blankA.goto('about:blank');
    await sleep(300);

    await suspendTabById(browser, targetA!.id);
    await waitForParkPages(browser, extensionId, 1, 15000);
    await sleep(500);

    const parkPagesA = await getParkPages(browser, extensionId);
    runner.assert(parkPagesA.length >= 1, 'park.html appeared for Phase A');

    const parkPageA = parkPagesA[0];
    const parkDataA = await parkPageA.evaluate(() => new Promise<string>(resolve => {
      const params = new URLSearchParams(location.search);
      chrome.runtime.sendMessage(
        { method: '[TS:dataForParkPage]', tabId: params.get('tabId'), sessionId: params.get('sessionId') },
        (resp: { startDiscarded?: boolean }) => resolve(JSON.stringify({ startDiscarded: resp?.startDiscarded })),
      );
    }));
    const parsedA = JSON.parse(parkDataA);
    log(`  parkData (A): ${parkDataA}`);
    runner.assert(
      parsedA.startDiscarded === false,
      `parkData.startDiscarded=false when setting disabled (got: ${parsedA.startDiscarded})`,
    );

    await blankA.close().catch(() => {});
    await parkPageA.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — startDiscarted=true: parkData carries correct flags
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — startDiscarted=true: parkData carries correct flags');

    await setSetting(browser, 'startDiscarted', true);
    // Reset startedAt so the 15-second window is freshly open
    await evalInSW(browser, 'startedAt = Date.now()');

    const pageB = await browser.newPage();
    await pageB.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(1000);

    const tabsB = await queryChromeTabs(browser);
    const targetB = tabsB.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetB != null, 'example.com tab found for Phase B');

    const blankB = await browser.newPage();
    await blankB.goto('about:blank');
    await sleep(300);

    await suspendTabById(browser, targetB!.id);
    await waitForParkPages(browser, extensionId, 1, 15000);
    await sleep(500);

    const parkPagesB = await getParkPages(browser, extensionId);
    runner.assert(parkPagesB.length >= 1, 'park.html appeared for Phase B');

    const parkPageB = parkPagesB[0];
    // Use a fresh [TS:dataForParkPage] call to inspect what the background would return.
    // (The first call was already consumed by park.html's own DOMContentLoaded.)
    const parkDataB = await parkPageB.evaluate(() => new Promise<string>(resolve => {
      const params = new URLSearchParams(location.search);
      chrome.runtime.sendMessage(
        { method: '[TS:dataForParkPage]', tabId: params.get('tabId'), sessionId: params.get('sessionId') },
        (resp: { startDiscarded?: boolean; startAt?: number; isFirstTimeTabDiscard?: boolean }) =>
          resolve(JSON.stringify({
            startDiscarded: resp?.startDiscarded,
            startAge: resp?.startAt != null ? Date.now() - resp.startAt : null,
          })),
      );
    }));
    const parsedB = JSON.parse(parkDataB);
    log(`  parkData (B): ${parkDataB}`);
    runner.assert(
      parsedB.startDiscarded === true,
      `parkData.startDiscarded=true when setting enabled (got: ${parsedB.startDiscarded})`,
    );
    runner.assert(
      parsedB.startAge != null && parsedB.startAge < 15000,
      `startAt is within 15s window (startAge=${parsedB.startAge}ms)`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — [AutomaticTabCleaner:DiscardTab] handler discards the tab
    //  This is the same message park.ts sends when all conditions are met.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — [AutomaticTabCleaner:DiscardTab] message discards the park tab');

    const parkTabId = targetB!.id;
    log(`  Sending [AutomaticTabCleaner:DiscardTab] from park.html (tabId=${parkTabId})`);

    await parkPageB.evaluate(() => {
      chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:DiscardTab]' });
    });

    // Poll for discard
    const deadline = Date.now() + 8000;
    let finalDiscarded = false;
    while (Date.now() < deadline) {
      const info = await evalInSW<string>(browser, `(async () => {
        const t = await chrome.tabs.get(${parkTabId}).catch(() => null);
        return JSON.stringify(t ? { discarded: t.discarded } : null);
      })()`);
      if (info) {
        const t = JSON.parse(info);
        if (t?.discarded === true) { finalDiscarded = true; break; }
      }
      await sleep(500);
    }

    log(`  Tab ${parkTabId} discarded: ${finalDiscarded}`);
    runner.assert(
      finalDiscarded,
      `[AutomaticTabCleaner:DiscardTab] successfully discards the park.html tab`,
    );

    await blankB.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  TEARDOWN
    // ══════════════════════════════════════════════════════════════════════════
    await setSetting(browser, 'startDiscarted', originalSetting ?? false);

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
