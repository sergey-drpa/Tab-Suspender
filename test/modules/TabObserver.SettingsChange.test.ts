/**
 * TabObserver — Settings Change Tests
 *
 * Covers TEST_CASES.md section 11, case 11.4:
 *   11.4 — Changing timeout → TabObserver immediately applies new value
 *
 * Key implementation in TabObserver.ts:
 *   settingsChanged() {
 *     this.start().catch(console.error);        // restart ticker
 *     this.tick(true).catch(console.error);     // stateOnly tick — reads new settings, no time accumulation
 *   }
 *
 * tick() reads `timeoutSettings` fresh via `await settings.get('timeout')` every call,
 * so there is no caching — the very next real tick uses whatever timeout is now in settings.
 */

import '../lib/Chrome';
import '../typing/global.d';

const PARK_URL = 'chrome-extension://test/park.html';
const TAB_URL  = 'https://example.com';

(global as any).sessionsPageUrl      = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl        = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl       = 'chrome-extension://test/history.html';
(global as any).parkUrl              = PARK_URL;
(global as any).publicExtensionUrl   = PARK_URL;
(global as any).trace                = false;
(global as any).debug                = false;
(global as any).debugTabsInfo        = false;
(global as any).debugScreenCache     = false;
(global as any).TSSessionId          = 123456;
(global as any).getScreenCache       = null;
(global as any).pauseTics            = 0;
(global as any).pauseTicsStartedFrom = 0;
(global as any).isCharging           = false;
(global as any).batteryLevel         = 1.0;

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
});
(global as any).extractHostname = jest.fn((url: string) => {
  try { return new URL(url).hostname; } catch { return ''; }
});

(global as any).discardTab              = jest.fn();
(global as any).markForUnsuspend        = jest.fn();
(global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(false);
(global as any).closeTab                = jest.fn();
(global as any).parkTab                 = jest.fn().mockResolvedValue(undefined);

// Per-test settings overrides: tests write to this object to change individual values.
let settingsOverrides: Record<string, any> = {};

(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: true,
      timeout: 90,          // 90 s default — 9 ticks of 10 s needed to reach threshold
      pinned: false,
      isCloseTabsOn: false,
      limitOfOpenedTabs: 20,
      closeTimeout: 3600,
      ignoreAudible: false,
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: false,
      discardTimeoutFactor: 0.05,
      enableSuspendOnlyIfBattLvlLessValue: false,
      battLvlLessValue: 50,
      adaptiveSuspendTimeout: false,
      ignoreCloseGroupedTabs: false,
      ignoreSuspendGroupedTabs: false,
    };
    const value = key in settingsOverrides ? settingsOverrides[key]
                : key in defaults           ? defaults[key]
                : false;
    return Promise.resolve(value);
  }),
};

(global as any).whiteList  = { isURIException: jest.fn().mockReturnValue(false) };
(global as any).ignoreList = { isTabInIgnoreTabList: jest.fn().mockReturnValue(false) };
(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).ContextMenuController = { menuIdMap: {} };
(global as any).ScreenshotController  = { getScreen: jest.fn() };

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn(),
  synchronizeActiveTabs: jest.fn(),
}));
const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(), onTabUpdate: jest.fn(), onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn(),
}));
(global as any).BrowserActionControl    = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 10, url: TAB_URL, title: 'Test Tab',
    active: false, audible: false, status: 'complete',
    windowId: 1, index: 0, pinned: false,
    groupId: -1, discarded: false,
    favIconUrl: 'https://example.com/favicon.ico',
    highlighted: false, incognito: false, selected: true, autoDiscardable: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TabObserver — Settings Change (11.4)', () => {
  let tabManager:       any;
  let tabObserver:      any;
  let TabObserverClass: any;
  let TabManagerClass:  any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    settingsOverrides = {};
    (global as any).parkTab              = jest.fn().mockResolvedValue(undefined);
    (global as any).pauseTics            = 0;
    (global as any).pauseTicsStartedFrom = 0;

    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const { TabInfo } = require('../../modules/model/TabInfo');
    (global as any).TabInfo = TabInfo;

    const { TabManager } = require('../../modules/TabManager');
    (global as any).TabManager = TabManagerClass = TabManager;

    require('../../modules/TabObserver');
    TabObserverClass = (global as any).TabObserver;
    tabManager = new TabManagerClass();
  });

  function setWindowTab(tab: chrome.tabs.Tab) {
    (global as any).chrome.windows.getAll = jest.fn((_opts: any, cb: any) =>
      cb([{ id: 1, focused: true, tabs: [tab] }])
    );
  }

  /** Run n real (non-stateOnly) ticks, draining the fire-and-forget callback chain. */
  async function runTicks(n: number) {
    for (let i = 0; i < n; i++) {
      await tabObserver.tick(false);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11.4 — Changing timeout → TabObserver immediately applies new value
  // ══════════════════════════════════════════════════════════════════════════
  describe('11.4 — Changing timeout immediately applies new value', () => {

    // ────────────────────────────────────────────────────────────────────────
    it('tab NOT suspended within 3 ticks when timeout is 90 s (baseline)', async () => {
      // Sanity check: with the default 90 s timeout, 3 ticks × 10 s = 30 s is not enough
      // to reach the suspension threshold.
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(3);

      const tabInfo = tabManager.getTabInfoById(tab.id);
      expect(tabInfo?.time).toBe(30); // accumulated but below threshold
      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    // ────────────────────────────────────────────────────────────────────────
    it('tab IS suspended on the next tick after timeout is reduced to 30 s', async () => {
      // Strategy:
      //   tick 1–3  (timeout=90): time = 10, 20, 30 → below threshold, no suspension
      //   settingsChanged() → tick(true) stateOnly: no time change, reads new settings
      //   tick 4    (timeout=30): time = 40 ≥ 30 → parkTab called
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // 3 normal ticks with the original 90 s timeout
      await runTicks(3);
      expect((global as any).parkTab).not.toHaveBeenCalled();

      const tabInfoAfter3 = tabManager.getTabInfoById(tab.id);
      expect(tabInfoAfter3?.time).toBe(30);

      // Simulate settings change: reduce timeout to 30 s
      settingsOverrides['timeout'] = 30;
      tabObserver.settingsChanged();

      // Drain the stateOnly tick fired by settingsChanged()
      await Promise.resolve();
      await Promise.resolve();

      // One real tick: time = 40 ≥ 30 → suspension
      await runTicks(1);

      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });

    // ────────────────────────────────────────────────────────────────────────
    it('settingsChanged() resolves without throwing', async () => {
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // settingsChanged() fires two async operations internally; it should not throw.
      expect(() => tabObserver.settingsChanged()).not.toThrow();

      // Allow async work to complete
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ────────────────────────────────────────────────────────────────────────
    it('stateOnly tick from settingsChanged() does NOT accumulate tabInfo.time', async () => {
      // settingsChanged() calls tick(true) — stateOnly=true skips the time-accumulation
      // branch entirely.  After the stateOnly tick, time should be exactly as it was.
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // 2 real ticks → time = 20 s
      await runTicks(2);
      const timeBefore = tabManager.getTabInfoById(tab.id)?.time;
      expect(timeBefore).toBe(20);

      // settingsChanged() fires a stateOnly tick — must NOT add more time
      tabObserver.settingsChanged();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const timeAfter = tabManager.getTabInfoById(tab.id)?.time;
      expect(timeAfter).toBe(timeBefore);
    });

    // ────────────────────────────────────────────────────────────────────────
    it('increasing timeout after tabs have accumulated time delays suspension', async () => {
      // Scenario:
      //   tick 1–3  (timeout=30): time = 10, 20, 30 — threshold reached on tick 3; tab parked.
      //   Increase timeout to 90 BEFORE the third tick fires to show the new value is read.
      //   Instead: run 2 ticks normally, then raise timeout to 90, run 1 more tick → no suspension.
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // Start with a short timeout
      settingsOverrides['timeout'] = 30;

      // 2 ticks → time = 20 s (below 30 s threshold)
      await runTicks(2);
      expect((global as any).parkTab).not.toHaveBeenCalled();

      // Increase timeout so the tab is no longer over the threshold
      settingsOverrides['timeout'] = 90;
      tabObserver.settingsChanged();
      await Promise.resolve();
      await Promise.resolve();

      // 1 more tick: time = 30 s; threshold is now 90 s → no suspension
      await runTicks(1);
      expect((global as any).parkTab).not.toHaveBeenCalled();

      const tabInfo = tabManager.getTabInfoById(tab.id);
      expect(tabInfo?.time).toBe(30);
    });

    // ────────────────────────────────────────────────────────────────────────
    it('calling settingsChanged() multiple times in a row does not crash', async () => {
      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(1);

      // Multiple rapid settings changes
      expect(() => {
        tabObserver.settingsChanged();
        tabObserver.settingsChanged();
        tabObserver.settingsChanged();
      }).not.toThrow();

      // Allow all async work to settle
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Ticker is still operational after repeated restarts
      settingsOverrides['timeout'] = 10;
      await runTicks(1);
      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });
  });
});
