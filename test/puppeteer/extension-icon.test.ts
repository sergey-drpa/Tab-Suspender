/**
 * Tab Suspender — Extension Icon State E2E Test
 *
 * Covers test case:
 *   17.5 — Extension icon changes: normal / off / paused / whitelisted / ignored
 *
 * Icon paths (from BrowserActionControl.ts):
 *   normal    img/icon16.png               active=true, not paused/whitelisted/ignored
 *   off       img/icon16_off.png           active=false
 *   paused    img/icon16_paused.png        pauseTics > 0
 *   whitelist img/icon16_green.png         active tab URL matches a whitelist pattern
 *   ignored   img/icon16_green_minus.png   active tab is in the per-session ignore list
 *
 * Strategy: call `synchronizeActiveTabs()` on a fresh BrowserActionControl instance via
 * evalInSW after configuring the desired state, then read the `lastIcon` global which is
 * updated as a side-effect of `chrome.action.setIcon()`.
 *
 * Run:
 *   cd test/puppeteer && npx tsx extension-icon.test.ts
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
  setSetting,
  getSetting,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-ext-icon');

const TEST_URL     = 'https://example.com/';
const TEST_PATTERN = '*example.com*';

// Force re-evaluation of the icon by resetting lastIcon and calling synchronizeActiveTabs().
// Returns the icon path that was passed to chrome.action.setIcon after the state update.
async function triggerAndGetIcon(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  pauseTicsValue = 0,
): Promise<string> {
  return evalInSW<string>(browser, `
    (async () => {
      lastIcon = '';
      pauseTics = ${pauseTicsValue};
      const bac = new BrowserActionControl(
        settings,
        whiteList,
        ContextMenuController.menuIdMap,
        ${pauseTicsValue}
      );
      bac.synchronizeActiveTabs();
      await new Promise(r => setTimeout(r, 1200));
      return lastIcon;
    })()
  `);
}

async function activateTab(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  tabId: number,
): Promise<void> {
  await evalInSW(browser, `chrome.tabs.update(${tabId}, { active: true })`);
  await sleep(500);
}

async function main(): Promise<void> {
  log('Tab Suspender — Extension Icon States (17.5)');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    await getExtensionId(browser);
    await waitForExtensionInit(browser);
    log('Extension initialized');

    // Open a real tab that we can whitelist / ignore
    const testPage = await browser.newPage();
    await testPage.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await sleep(1000);

    const allTabs = await queryChromeTabs(browser);
    const testTab = allTabs.find(t => t.url?.startsWith('https://example.com'));
    runner.assert(testTab != null, `Test tab is open at ${TEST_URL}`);
    const testTabId = testTab!.id;
    log(`  Test tab ID: ${testTabId}`);

    // Make sure it's the active tab before each icon check
    await activateTab(browser, testTabId);

    // Ensure clean state: active=true, pauseTics=0, no whitelist, no ignore
    await setSetting(browser, 'active', true);

    // Clean up any leftover whitelist pattern from previous runs
    await evalInSW(browser, `whiteList.removePatternsAffectUrl(${JSON.stringify(TEST_URL)})`).catch(() => {});
    await evalInSW(browser, `ignoreList.removeFromIgnoreTabList(${testTabId})`).catch(() => {});
    await sleep(300);

    // ── Phase A: Normal (active=true) → img/icon16.png ───────────────────────
    runner.section('Phase A — Normal state: active=true, not paused/whitelisted/ignored');

    await activateTab(browser, testTabId);
    const iconNormal = await triggerAndGetIcon(browser, 0);

    runner.assert(
      iconNormal === 'img/icon16.png',
      `Normal icon is img/icon16.png (got: ${iconNormal})`,
    );
    log(`  Normal icon: ${iconNormal}`);

    // ── Phase B: Off (active=false) → img/icon16_off.png ─────────────────────
    runner.section('Phase B — Off state: active=false');

    await setSetting(browser, 'active', false);
    await activateTab(browser, testTabId);
    const iconOff = await triggerAndGetIcon(browser, 0);

    runner.assert(
      iconOff === 'img/icon16_off.png',
      `Off icon is img/icon16_off.png (got: ${iconOff})`,
    );
    log(`  Off icon: ${iconOff}`);

    // Restore active state
    await setSetting(browser, 'active', true);
    await sleep(300);

    // ── Phase C: Paused (pauseTics > 0) → img/icon16_paused.png ──────────────
    runner.section('Phase C — Paused state: pauseTics=5');

    await activateTab(browser, testTabId);
    const iconPaused = await triggerAndGetIcon(browser, 5);

    runner.assert(
      iconPaused === 'img/icon16_paused.png',
      `Paused icon is img/icon16_paused.png (got: ${iconPaused})`,
    );
    log(`  Paused icon: ${iconPaused}`);

    // Reset pauseTics
    await evalInSW(browser, 'pauseTics = 0');
    await sleep(300);

    // ── Phase D: Whitelisted tab → img/icon16_green.png ──────────────────────
    runner.section(`Phase D — Whitelisted tab: pattern "${TEST_PATTERN}"`);

    await evalInSW(browser, `whiteList.addPattern(${JSON.stringify(TEST_PATTERN)})`);
    await sleep(300);

    const isWhitelisted = await evalInSW<boolean>(
      browser,
      `whiteList.isURIException(${JSON.stringify(TEST_URL)})`,
    );
    runner.assert(isWhitelisted === true, `URL is whitelisted before icon check (got: ${isWhitelisted})`);

    await activateTab(browser, testTabId);
    const iconWhitelisted = await triggerAndGetIcon(browser, 0);

    runner.assert(
      iconWhitelisted === 'img/icon16_green.png',
      `Whitelisted icon is img/icon16_green.png (got: ${iconWhitelisted})`,
    );
    log(`  Whitelisted icon: ${iconWhitelisted}`);

    // Clean whitelist before next phase
    await evalInSW(browser, `whiteList.removePatternsAffectUrl(${JSON.stringify(TEST_URL)})`).catch(() => {});
    await sleep(300);

    // ── Phase E: Ignored tab → img/icon16_green_minus.png ────────────────────
    runner.section('Phase E — Ignored tab (per-session ignore list)');

    await evalInSW(browser, `ignoreList.addToIgnoreTabList(${testTabId})`);
    await sleep(300);

    const isIgnored = await evalInSW<boolean>(
      browser,
      `ignoreList.isTabInIgnoreTabList(${testTabId})`,
    );
    runner.assert(isIgnored === true, `Tab ${testTabId} is in ignore list before icon check (got: ${isIgnored})`);

    await activateTab(browser, testTabId);
    const iconIgnored = await triggerAndGetIcon(browser, 0);

    runner.assert(
      iconIgnored === 'img/icon16_green_minus.png',
      `Ignored icon is img/icon16_green_minus.png (got: ${iconIgnored})`,
    );
    log(`  Ignored icon: ${iconIgnored}`);

    // ── Phase F: Restore state ────────────────────────────────────────────────
    runner.section('Phase F — Restore clean state');

    await evalInSW(browser, `ignoreList.removeFromIgnoreTabList(${testTabId})`);
    await evalInSW(browser, 'pauseTics = 0');
    const originalActive = await getSetting(browser, 'active');
    if (!originalActive) await setSetting(browser, 'active', true);

    await activateTab(browser, testTabId);
    const iconFinal = await triggerAndGetIcon(browser, 0);

    runner.assert(
      iconFinal === 'img/icon16.png',
      `Icon restored to normal after cleanup (got: ${iconFinal})`,
    );

    log('\n  All icon state transitions verified');

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
