/**
 * Tab Suspender — Multi-Window Suspension E2E Test (PR #64)
 *
 * Covers the multi-window behavior end-to-end with REAL window focus/state
 * semantics (headed Chrome), on top of the unit coverage (1.11/1.12):
 *
 *   Phase A — fresh install default (suspendUnfocusedActiveTabs=true via the
 *             settings-store migration): with two windows, the ACTIVE tab of
 *             the UNFOCUSED window is auto-suspended after the timeout, while
 *             the active tab of the FOCUSED window is never touched.
 *
 *   Phase B — minimized window: with the setting turned OFF, the active tab of
 *             a MINIMIZED window is still auto-suspended (minimized overrides
 *             the opt-in).
 *
 * Run:
 *   cd test/puppeteer && npx tsx multi-window-suspend.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-multi-window');

/** Poll until the tab's URL starts with the park prefix (or deadline). */
async function isTabParked(browser: any, tabId: number, parkPrefix: string): Promise<boolean> {
  const json = await evalInSW<string>(browser, `(async () => {
    const t = await chrome.tabs.get(${tabId}).catch(() => null);
    return JSON.stringify(t ? { url: t.url } : null);
  })()`);
  if (!json) return false;
  const t = JSON.parse(json) as { url: string } | null;
  return t != null && typeof t.url === 'string' && t.url.startsWith(parkPrefix);
}

async function main(): Promise<void> {
  log('Tab Suspender — Multi-Window Suspension (PR #64)');
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

    const parkPrefix = parkUrlPrefix(extensionId);

    // Close stale extension tabs (wizard_background.html etc.) — they would
    // accumulate inactivity and suspend first, confusing the assertions.
    const tabsBefore = await queryChromeTabs(browser);
    for (const et of tabsBefore.filter(t => t.url?.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html'))) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
    }
    await sleep(300);

    originalTimeout = await getSetting<number>(browser, 'timeout');
    await setSetting(browser, 'timeout', 10);
    log(`  timeout set to 10s (was ${originalTimeout}s)`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — unfocused window's active tab suspended; focused protected
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — fresh install default ON: unfocused window suspended, focused protected');

    // A1. Fresh profile ⇒ migration must have enabled the setting (11.8 e2e check)
    let settingOn: unknown = null;
    for (let i = 0; i < 10 && settingOn !== true; i++) {
      settingOn = await getSetting(browser, 'suspendUnfocusedActiveTabs');
      if (settingOn !== true) await sleep(500);
    }
    runner.assert(settingOn === true, 'fresh install: suspendUnfocusedActiveTabs is true (migration)');

    // A2. Window 1: example.com — the active tab of the window we keep focused
    const page1 = await browser.newPage();
    await page1.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(2000); // status='complete'

    const tabs1 = await queryChromeTabs(browser);
    const tab1 = tabs1.find(t => t.url?.includes('example.com'));
    runner.assert(tab1 != null, 'example.com tab exists (window 1)');
    const win1Id = tab1!.windowId;
    const tab1Id = tab1!.id;

    // A3. Window 2: example.org — created focused, then we refocus window 1
    const win2Json = await evalInSW<string>(browser, `(async () => {
      const win = await chrome.windows.create({ url: 'https://example.org/' });
      return JSON.stringify({ id: win.id, tabId: win.tabs[0].id });
    })()`);
    const win2 = JSON.parse(win2Json) as { id: number; tabId: number };
    await sleep(3000); // example.org reaches status='complete'

    await evalInSW(browser, `chrome.windows.update(${win1Id}, { focused: true })`);
    await sleep(1000); // let the extension observe the focus change

    const focusJson = await evalInSW<string>(browser, `(async () => {
      const ws = await chrome.windows.getAll();
      return JSON.stringify(ws.map(w => ({ id: w.id, focused: w.focused, state: w.state })));
    })()`);
    const focusState = JSON.parse(focusJson) as Array<{ id: number; focused: boolean; state: string }>;
    log(`  windows: ${JSON.stringify(focusState)}`);
    runner.assert(
      focusState.find(w => w.id === win1Id)?.focused === true
      && focusState.find(w => w.id === win2.id)?.focused === false,
      'window 1 focused, window 2 unfocused (real focus state)',
    );

    // A4. Wait: window 2's ACTIVE tab must be auto-suspended (setting ON)
    log('  Waiting for example.org (unfocused window) to be auto-suspended...');
    const deadlineA = Date.now() + 40000;
    let orgParked = false;
    while (Date.now() < deadlineA && !orgParked) {
      orgParked = await isTabParked(browser, win2.tabId, parkPrefix);
      if (!orgParked) await sleep(1000);
    }
    runner.assert(orgParked, `active tab of the UNFOCUSED window was auto-suspended (tabId=${win2.tabId})`);

    // A5. The focused window's active tab must stay untouched
    const comParked = await isTabParked(browser, tab1Id, parkPrefix);
    runner.assert(!comParked, 'active tab of the FOCUSED window was NOT suspended');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — minimized window suspended even with the setting OFF
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — setting OFF: minimized window still suspended');

    await setSetting(browser, 'suspendUnfocusedActiveTabs', false);
    log('  suspendUnfocusedActiveTabs set to false');

    const win3Json = await evalInSW<string>(browser, `(async () => {
      const win = await chrome.windows.create({ url: 'https://example.net/' });
      return JSON.stringify({ id: win.id, tabId: win.tabs[0].id });
    })()`);
    const win3 = JSON.parse(win3Json) as { id: number; tabId: number };
    await sleep(3000);

    await evalInSW(browser, `chrome.windows.update(${win3.id}, { state: 'minimized' })`);
    await evalInSW(browser, `chrome.windows.update(${win1Id}, { focused: true })`);
    await sleep(1000);

    // Wait for window to actually reach minimized state (can be async on CI)
    // Poll from test side so we can log each attempt
    let minState: { state: string; focused: boolean };
    let tries = 0;
    const maxTries = 60; // 60 * 500ms = 30 seconds max
    while (tries < maxTries) {
      const minJson = await evalInSW<string>(browser, `(async () => {
        const w = await chrome.windows.get(${win3.id});
        return JSON.stringify({ state: w.state, focused: w.focused });
      })()`);
      minState = JSON.parse(minJson) as { state: string; focused: boolean };
      log(`  window 3 state check ${tries + 1}/${maxTries}: ${JSON.stringify(minState)}`);
      if (minState.state === 'minimized') break;
      await sleep(500);
      tries++;
    }
    log(`  window 3: ${JSON.stringify(minState)}`);
    runner.assert(minState!.state === 'minimized', 'window 3 is minimized (real window state)');

    log('  Waiting for example.net (minimized window) to be auto-suspended...');
    const deadlineB = Date.now() + 40000;
    let netParked = false;
    while (Date.now() < deadlineB && !netParked) {
      netParked = await isTabParked(browser, win3.tabId, parkPrefix);
      if (!netParked) await sleep(1000);
    }
    runner.assert(netParked, `active tab of the MINIMIZED window was auto-suspended despite setting OFF (tabId=${win3.tabId})`);

    // The focused window's active tab is still untouchable
    const comParkedB = await isTabParked(browser, tab1Id, parkPrefix);
    runner.assert(!comParkedB, 'focused window active tab still NOT suspended after phase B');

  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    await browser.close();
    log('Browser closed');
  }

  runner.summarize();
  if (runner.hasFailed()) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
