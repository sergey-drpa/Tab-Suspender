/**
 * Tab Restore Behavior Tests
 *
 * Covers TEST_CASES.md section 2 (unit-testable cases):
 *   2.5 — After restore, parked/time/suspended_time flags are reset
 *   2.7 — Repeated restore of an already-restored tab causes no errors
 */

import '../lib/Chrome';
import '../typing/global.d';

const PARK_URL = 'chrome-extension://test/park.html';
const ORIGINAL_URL = 'https://example.com';
const PARK_URL_WITH_PARAMS = `${PARK_URL}?url=${encodeURIComponent(ORIGINAL_URL)}&tabId=42&sessionId=123456`;

(global as any).sessionsPageUrl      = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl        = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl       = 'chrome-extension://test/history.html';
(global as any).parkUrl              = PARK_URL;
(global as any).trace                = false;
(global as any).debug                = false;
(global as any).debugScreenCache     = false;
(global as any).TSSessionId          = 123456;
(global as any).getScreenCache       = null;

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
});

(global as any).extractHostname = jest.fn((url: string) => {
  try { return new URL(url).hostname; } catch { return ''; }
});

(global as any).discardTab       = jest.fn();
(global as any).markForUnsuspend = jest.fn();
(global as any).pauseTics        = 0;
(global as any).nextTabShouldBeSuspended = false;

(global as any).settings = {
  get: jest.fn().mockResolvedValue(false)
};

(global as any).whiteList = {
  isURIException: jest.fn().mockReturnValue(false)
};

(global as any).ignoreList = {
  isTabInIgnoreTabList: jest.fn().mockReturnValue(false)
};

(global as any).tabCapture = {
  captureTab: jest.fn(),
  injectJS: jest.fn()
};

(global as any).ContextMenuController = { menuIdMap: {} };
(global as any).ScreenshotController  = { getScreen: jest.fn() };

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn(),
  synchronizeActiveTabs: jest.fn(),
}));

const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(),
  onTabUpdate: jest.fn(),
  onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn(),
}));

const TabObserver = { tickSize: 10 };

(global as any).BrowserActionControl    = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;
(global as any).TabObserver             = TabObserver;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 42, url: ORIGINAL_URL, title: 'Test Tab',
    active: false, audible: false, status: 'complete',
    windowId: 1, index: 0, pinned: false,
    groupId: -1, discarded: false,
    favIconUrl: 'https://example.com/favicon.ico',
    highlighted: false, incognito: false, selected: false, autoDiscardable: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

function makeParkedTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return makeTab({ url: PARK_URL_WITH_PARAMS, ...overrides });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TabManager — Tab Restore Behavior', () => {
  let tabManager: any;
  let TabManagerClass: any;
  let onUpdatedListener: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    (global as any).getScreenCache = null;
    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const { TabInfo } = require('../../modules/model/TabInfo');
    (global as any).TabInfo = TabInfo;

    const { TabManager } = require('../../modules/TabManager');
    TabManagerClass = TabManager;
    tabManager = new TabManager();

    // Capture the onUpdated listener registered during construction
    const calls = (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls;
    onUpdatedListener = calls[calls.length - 1][0];
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2.5 — After restore, parked/time/suspended_time flags are reset
  // ══════════════════════════════════════════════════════════════════════════
  describe('2.5 — After restore all state flags are reset', () => {

    it('setTabUnsuspended resets time, suspended_time and parkTrys to zero', () => {
      const tab = makeTab();
      const tabInfo = tabManager.getTabInfoOrCreate(tab);

      // Simulate accumulated suspension state
      tabInfo.time = 150;
      tabInfo.suspended_time = 90;
      tabInfo.parkTrys = 2;

      tabManager.setTabUnsuspended(tab);

      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
    });

    it('setTabUnsuspended resets state after markTabParked was called', () => {
      const parkedTab = makeParkedTab();
      tabManager.markTabParked(parkedTab);

      const tabInfo = tabManager.getTabInfoById(parkedTab.id);
      expect(tabInfo.parked).toBe(true);

      // Accumulate time while suspended
      tabInfo.time = 200;
      tabInfo.suspended_time = 120;
      tabInfo.parkTrys = 1;

      // Restore arrives
      const restoredTab = makeTab(); // same tab id, now at original URL
      tabManager.setTabUnsuspended(restoredTab);

      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
    });

    it('tabs.onUpdated with non-park URL clears the parked flag', () => {
      const parkedTab = makeParkedTab();
      tabManager.markTabParked(parkedTab);

      const tabInfo = tabManager.getTabInfoById(parkedTab.id);
      expect(tabInfo.parked).toBe(true);

      // Tab navigates to original URL — onUpdated fires
      const restoredTab = makeTab({ url: ORIGINAL_URL, status: 'complete' });
      onUpdatedListener(restoredTab.id, { url: ORIGINAL_URL, status: 'complete' }, restoredTab);

      expect(tabInfo.parked).toBe(false);
    });

    it('full restore sequence: park → accumulate time → setTabUnsuspended + onUpdated → all flags cleared', () => {
      const parkedTab = makeParkedTab();
      tabManager.markTabParked(parkedTab);

      const tabInfo = tabManager.getTabInfoById(parkedTab.id);
      expect(tabInfo.parked).toBe(true);

      // Simulate 5 minutes of suspension
      tabInfo.time = 300;
      tabInfo.suspended_time = 300;
      tabInfo.parkTrys = 1;

      // 1) BGMessageListener receives TabUnsuspended message → setTabUnsuspended
      const restoredTab = makeTab();
      tabManager.setTabUnsuspended(restoredTab);

      // 2) tabs.onUpdated fires as the tab navigates back to original URL
      onUpdatedListener(restoredTab.id, { url: ORIGINAL_URL, status: 'complete' }, restoredTab);

      // All suspension state cleared
      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
      expect(tabInfo.parked).toBe(false);
    });

    it('parkedUrl is cleared when onUpdated fires with a DIFFERENT regular URL', () => {
      // parkedUrl is only cleared when the tab navigates to a URL that DIFFERS
      // from the recorded parkedUrl — if restoring to the same URL it stays set
      // (used by the parkedCount logic to detect same-site re-parks)
      const parkedTab = makeParkedTab();
      tabManager.markTabParked(parkedTab);

      const tabInfo = tabManager.getTabInfoById(parkedTab.id);
      expect(tabInfo.parkedUrl).toBe(ORIGINAL_URL);

      // Navigate to a DIFFERENT URL — parkedUrl should be cleared
      const otherUrl = 'https://different.com';
      const differentTab = makeTab({ url: otherUrl });
      onUpdatedListener(differentTab.id, { url: otherUrl }, differentTab);

      expect(tabInfo.parkedUrl).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2.7 — Repeated restore of already-restored tab causes no errors
  // ══════════════════════════════════════════════════════════════════════════
  describe('2.7 — Repeated restore is idempotent and safe', () => {

    it('calling setTabUnsuspended twice in a row does not throw', () => {
      const tab = makeTab();
      tabManager.getTabInfoOrCreate(tab);

      expect(() => {
        tabManager.setTabUnsuspended(tab);
        tabManager.setTabUnsuspended(tab);
      }).not.toThrow();
    });

    it('calling setTabUnsuspended on a tab that was never parked does not throw', () => {
      // Tab with no prior tabInfo entry
      const freshTab = makeTab({ id: 999, url: 'https://never-parked.com' });

      expect(() => {
        tabManager.setTabUnsuspended(freshTab);
      }).not.toThrow();
    });

    it('second setTabUnsuspended call leaves time and suspended_time at zero', () => {
      const tab = makeTab();
      const tabInfo = tabManager.getTabInfoOrCreate(tab);

      // First restore
      tabInfo.time = 100;
      tabInfo.suspended_time = 50;
      tabManager.setTabUnsuspended(tab);

      // Verify already zero
      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);

      // Second restore (e.g., duplicate message)
      tabManager.setTabUnsuspended(tab);

      // Still zero — no negative values or other corruption
      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
    });

    it('onUpdated with non-park URL is safe to call multiple times on a restored tab', () => {
      const parkedTab = makeParkedTab();
      tabManager.markTabParked(parkedTab);

      const restoredTab = makeTab();

      expect(() => {
        // First onUpdated (status loading)
        onUpdatedListener(restoredTab.id, { url: ORIGINAL_URL, status: 'loading' }, restoredTab);
        // Second onUpdated (status complete)
        onUpdatedListener(restoredTab.id, { status: 'complete' }, { ...restoredTab, status: 'complete' });
        // Third: another URL change (e.g. redirect)
        onUpdatedListener(restoredTab.id, { url: ORIGINAL_URL + '/path' }, { ...restoredTab, url: ORIGINAL_URL + '/path' });
      }).not.toThrow();

      const tabInfo = tabManager.getTabInfoById(restoredTab.id);
      expect(tabInfo.parked).toBe(false);
    });
  });
});
