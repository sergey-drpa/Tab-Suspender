/**
 * TabObserver — Auto-Discard Unit Tests
 *
 * Covers TEST_CASES.md section 9:
 *   9.1 — discardTabAfterSuspendWithTimeout=true: parked tab is auto-discarded
 *          after (timeoutSettings × discardTimeoutFactor) seconds of being suspended
 *   9.2 — Tab marked for unsuspend: discard does NOT happen
 *
 * Key implementation path (TabObserver.ts ~276–310):
 *
 *   if (isTabParked) {
 *       tabInfo.discarded = tab.discarded;   // <-- BUG NOTE below
 *       // favicon retry ...
 *       if (!tabInfo.discarded && discardTabAfterSuspendWithTimeout)
 *           if (!tab.active) {
 *               if (tabInfo.suspended_time >= timeoutSettings * discardTimeoutFactor) {
 *                   if (!isTabMarkedForUnsuspend(...)) {
 *                       discardTab(tabId);
 *                       tabInfo.discarded = true;
 *                   }
 *               }
 *           }
 *   }
 *
 * BUG NOTE: The line `tabInfo.discarded = tab.discarded` at the TOP of the
 * isTabParked block resets tabInfo.discarded on EVERY tick from Chrome's
 * actual tab.discarded property. If discardTab() is asynchronous and Chrome
 * hasn't updated tab.discarded=true yet, the next tick would reset
 * tabInfo.discarded back to false and potentially re-trigger the discard call.
 * The tests below verify the expected one-shot behaviour under the assumption
 * that Chrome reflects tab.discarded=true synchronously after discardTab().
 */

import '../lib/Chrome';
import '../typing/global.d';

const PARK_URL  = 'chrome-extension://test/park.html';
const PARKED_URL = `${PARK_URL}?tabId=42&url=https%3A%2F%2Fexample.com&sessionId=123456`;

// ─── Globals ─────────────────────────────────────────────────────────────────

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

// Per-test settings overrides
let settingsOverrides: Record<string, any> = {};

(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: true,
      timeout: 30,
      pinned: false,
      isCloseTabsOn: false,
      limitOfOpenedTabs: 20,
      closeTimeout: 3600,
      ignoreAudible: false,
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: true,   // KEY: auto-discard enabled
      discardTimeoutFactor: 1,                   // threshold = 30 × 1 = 30 s
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

function makeParkedTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 42,
    url: PARKED_URL,
    title: 'Parked Tab',
    active: false,
    audible: false,
    status: 'complete',
    windowId: 1,
    index: 0,
    pinned: false,
    groupId: -1,
    discarded: false,
    favIconUrl: 'https://example.com/favicon.ico',
    highlighted: false,
    incognito: false,
    selected: false,
    autoDiscardable: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TabObserver — Auto-Discard of Parked Tabs', () => {
  let tabManager:       any;
  let tabObserver:      any;
  let TabObserverClass: any;
  let TabManagerClass:  any;

  // Mutable tab reference so individual tests can adjust properties between ticks
  let currentTab: chrome.tabs.Tab;

  function setWindowTab(tab: chrome.tabs.Tab) {
    (global as any).chrome.windows.getAll = jest.fn((_opts: any, cb: any) =>
      cb([{ id: 1, focused: true, tabs: [tab] }])
    );
  }

  async function runTicks(n: number) {
    for (let i = 0; i < n; i++) {
      await tabObserver.tick();
      // tick() is fire-and-forget via chrome.windows.getAll callback; flush two
      // microtask hops to let the inner async chain (isExceptionTab etc.) settle.
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    settingsOverrides = {};
    (global as any).discardTab              = jest.fn();
    (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(false);
    (global as any).parkTab                 = jest.fn().mockResolvedValue(undefined);
    (global as any).pauseTics               = 0;
    (global as any).pauseTicsStartedFrom    = 0;

    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const { TabInfo } = require('../../modules/model/TabInfo');
    (global as any).TabInfo = TabInfo;

    const { TabManager } = require('../../modules/TabManager');
    (global as any).TabManager = TabManagerClass = TabManager;

    require('../../modules/TabObserver');
    TabObserverClass = (global as any).TabObserver;

    tabManager = new TabManagerClass();

    currentTab = makeParkedTab();
    setWindowTab(currentTab);
    tabObserver = new TabObserverClass(tabManager);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9.1 — discardTabAfterSuspendWithTimeout=true triggers discard
  // ══════════════════════════════════════════════════════════════════════════
  describe('9.1 — Parked tab is auto-discarded after suspended_time reaches threshold', () => {

    it('calls discardTab after 3 ticks (suspended_time = 30 >= 30 × 1)', async () => {
      // tickSize=10, discardTimeoutFactor=1, timeout=30
      // After 3 ticks: suspended_time = 30 >= 30 → discard triggers
      await runTicks(3);

      expect((global as any).discardTab).toHaveBeenCalledWith(currentTab.id);
    });

    it('does NOT call discardTab before threshold is reached (2 ticks = 20 < 30)', async () => {
      await runTicks(2);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });

    it('calls discardTab exactly once even when more ticks follow (tab.discarded=true after discard)', async () => {
      // After discard Chrome marks tab.discarded=true; simulate that for subsequent ticks
      let discardCallCount = 0;
      (global as any).discardTab = jest.fn().mockImplementation(() => {
        discardCallCount++;
        // Simulate Chrome reflecting the discarded state back on the next tick
        currentTab = makeParkedTab({ discarded: true });
        setWindowTab(currentTab);
      });

      // 3 ticks → triggers discard; subsequent ticks see tab.discarded=true so
      // tabInfo.discarded stays true and the guard `!tabInfo.discarded` blocks re-trigger
      await runTicks(3);
      expect(discardCallCount).toBe(1);

      await runTicks(2);
      expect(discardCallCount).toBe(1);
    });

    it('sets tabInfo.discarded = true after calling discardTab', async () => {
      await runTicks(3);

      const tabInfo = tabManager.getTabInfoById(currentTab.id);
      expect(tabInfo?.discarded).toBe(true);
    });

    it('does NOT call discardTab when discardTabAfterSuspendWithTimeout is false', async () => {
      settingsOverrides['discardTabAfterSuspendWithTimeout'] = false;

      await runTicks(5);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });

    it('respects discardTimeoutFactor: factor=2 means threshold = 60 s (6 ticks)', async () => {
      settingsOverrides['discardTimeoutFactor'] = 2; // threshold = 30 × 2 = 60 s

      // 5 ticks = 50 s < 60 s → no discard yet
      await runTicks(5);
      expect((global as any).discardTab).not.toHaveBeenCalled();

      // 1 more tick = 60 s ≥ 60 s → discard triggers
      await runTicks(1);
      expect((global as any).discardTab).toHaveBeenCalledWith(currentTab.id);
    });

    it('does NOT call discardTab for an active parked tab (tab.active=true)', async () => {
      // Tab is parked but currently active (e.g., user clicked on it)
      currentTab = makeParkedTab({ active: true });
      setWindowTab(currentTab);

      // Even after suspended_time exceeds threshold, active tab must be spared
      await runTicks(5);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });

    it('increments suspended_time by tickSize on every parked-tab tick', async () => {
      await runTicks(2);

      const tabInfo = tabManager.getTabInfoById(currentTab.id);
      // 2 ticks × 10 s = 20 s
      expect(tabInfo?.suspended_time).toBe(20);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9.2 — Tab marked for unsuspend: discard does NOT happen
  // ══════════════════════════════════════════════════════════════════════════
  describe('9.2 — Tab marked for unsuspend prevents discard', () => {

    it('does NOT call discardTab when isTabMarkedForUnsuspend returns true', async () => {
      (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(true);

      // Run enough ticks to exceed the threshold
      await runTicks(5);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });

    it('calls isTabMarkedForUnsuspend with the correct tabId and sessionId from URL', async () => {
      (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(false);

      await runTicks(3);

      // Should be called with values parsed from the parked URL params
      expect((global as any).isTabMarkedForUnsuspend).toHaveBeenCalledWith('42', '123456');
    });

    it('discards when isTabMarkedForUnsuspend switches from true → false after threshold', async () => {
      // First few ticks: marked for unsuspend → no discard
      (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(true);
      await runTicks(4);
      expect((global as any).discardTab).not.toHaveBeenCalled();

      // Mark is cleared; next tick should discard (suspended_time already ≥ 30)
      (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(false);
      // tabInfo.discarded was not set to true (discard was blocked), so guard passes
      await runTicks(1);
      expect((global as any).discardTab).toHaveBeenCalledWith(currentTab.id);
    });

    it('does NOT call discardTab when both conditions block: active=true and marked for unsuspend', async () => {
      (global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(true);
      currentTab = makeParkedTab({ active: true });
      setWindowTab(currentTab);

      await runTicks(5);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Guard: non-parked tabs are never discarded by this logic
  // ══════════════════════════════════════════════════════════════════════════
  describe('Discard logic only applies to parked (suspended) tabs', () => {

    it('does NOT call discardTab for a normal (non-parked) tab', async () => {
      const normalTab = {
        id: 99,
        url: 'https://example.com',
        title: 'Normal Tab',
        active: false,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: -1,
        discarded: false,
        favIconUrl: 'https://example.com/favicon.ico',
        highlighted: false,
        incognito: false,
        selected: false,
        autoDiscardable: true,
      } as chrome.tabs.Tab;

      setWindowTab(normalTab);

      await runTicks(5);

      expect((global as any).discardTab).not.toHaveBeenCalled();
    });
  });
});
