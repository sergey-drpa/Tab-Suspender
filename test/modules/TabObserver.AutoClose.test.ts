/**
 * TabObserver — Auto-Close Rules Unit Tests
 *
 * Covers TEST_CASES.md section 8:
 *   8.1 — Total tabs > limit → lowest-rank tab is closed (closeTab called)
 *   8.2 — Grouped tab with ignoreCloseGroupedTabs=true → not closed
 *   8.3 — Rank formula selects the correct (lowest-rank) tab to close
 *   8.5 — Total tabs ≤ limit → no tab is closed
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
      timeout: 30,
      pinned: false,
      isCloseTabsOn: true,         // auto-close ON by default in this suite
      limitOfOpenedTabs: 2,        // low limit: only 2 tabs allowed before closing
      closeTimeout: 60,            // tabs with time >= 60 are close-candidates
      ignoreAudible: false,
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: false,
      discardTimeoutFactor: 2,
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
  updateStatus: jest.fn(), synchronizeActiveTabs: jest.fn(),
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

/** Drain the microtask queue completely.
 *  The close-tab path has many chained `await settings.get(...)` calls inside
 *  the fire-and-forget chrome.windows.getAll callback, so we need enough flushes
 *  to let all of them resolve before asserting. 30 is generous but deterministic. */
async function flushPromises(count = 30) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

/** Run one tick and drain the microtask queue. */
async function runTick(tabObserver: any) {
  await tabObserver.tick();
  await flushPromises();
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TabObserver — Auto-Close Rules', () => {
  let tabManager:       any;
  let tabObserver:      any;
  let TabObserverClass: any;
  let TabManagerClass:  any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    settingsOverrides = {};
    (global as any).closeTab = jest.fn();
    (global as any).parkTab  = jest.fn().mockResolvedValue(undefined);
    (global as any).pauseTics            = 0;
    (global as any).pauseTicsStartedFrom = 0;

    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const { TabInfo } = require('../../modules/model/TabInfo');
    (global as any).TabInfo = TabInfo;

    const { TabManager } = require('../../modules/TabManager');
    (global as any).TabManager = TabManagerClass = TabManager;

    require('../../modules/TabObserver');
    TabObserverClass = (global as any).TabObserver;
    // tickSize=10 means tickCount (incremented by 10 each tick) % 10 === 0 always,
    // so the close-tab block runs on every tick.
    TabObserverClass.tickSize = 10;

    tabManager  = new TabManagerClass();
    tabObserver = new TabObserverClass(tabManager);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8.1 — Total tabs > limit → lowest-rank tab is closed
  // ══════════════════════════════════════════════════════════════════════════
  describe('8.1 — Total tabs exceeding the limit causes the lowest-rank tab to be closed', () => {
    it('calls closeTab when tab count exceeds limitOfOpenedTabs', async () => {
      // limitOfOpenedTabs = 2, so 3 tabs triggers the close logic.
      const tab1 = makeTab({ id: 1, url: 'https://a.com' });
      const tab2 = makeTab({ id: 2, url: 'https://b.com' });
      const tab3 = makeTab({ id: 3, url: 'https://c.com' });

      const windows = [{ id: 1, tabs: [tab1, tab2, tab3] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      // Pre-populate tabInfo for all three tabs so getTabInfoById finds them.
      const info1 = tabManager.getTabInfoOrCreate(tab1);
      info1.time       = 100; // above closeTimeout (60)
      info1.active_time = 0;
      info1.swch_cnt   = 0;
      info1.parked     = false;

      const info2 = tabManager.getTabInfoOrCreate(tab2);
      info2.time       = 100;
      info2.active_time = 0;
      info2.swch_cnt   = 0;
      info2.parked     = false;

      const info3 = tabManager.getTabInfoOrCreate(tab3);
      info3.time       = 100;
      info3.active_time = 0;
      info3.swch_cnt   = 0;
      info3.parked     = false;

      await runTick(tabObserver);

      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
    });

    it('does not call closeTab more than once per tick even with many excess tabs', async () => {
      // Limit is 2, we have 5 tabs — still only one should be closed per tick.
      const tabs = [1, 2, 3, 4, 5].map(id =>
        makeTab({ id, url: `https://tab${id}.com` })
      );
      const windows = [{ id: 1, tabs }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      tabs.forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 100;
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      // The break after oneTabClosed = true ensures only 1 close per tick.
      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8.2 — Grouped tab with ignoreCloseGroupedTabs=true → not closed
  // ══════════════════════════════════════════════════════════════════════════
  describe('8.2 — Grouped tabs are excluded when ignoreCloseGroupedTabs is enabled', () => {
    it('does NOT close a grouped tab when ignoreCloseGroupedTabs=true', async () => {
      settingsOverrides = { ignoreCloseGroupedTabs: true };

      // Three tabs: one regular + two grouped.
      // The regular tab stays within the limit by itself, so no close should occur.
      const tabRegular = makeTab({ id: 1, url: 'https://regular.com', groupId: -1 });
      const tabGrouped1 = makeTab({ id: 2, url: 'https://grouped1.com', groupId: 5 });
      const tabGrouped2 = makeTab({ id: 3, url: 'https://grouped2.com', groupId: 5 });

      const windows = [{ id: 1, tabs: [tabRegular, tabGrouped1, tabGrouped2] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      // Pre-populate tabInfo for all tabs.
      [tabRegular, tabGrouped1, tabGrouped2].forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 100;
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      // Only tabRegular is eligible (grouped tabs filtered out by isPassGroupedTabsRules).
      // tabArray.length = 1 which is NOT > limitOfOpenedTabs (2), so closeTab is NOT called.
      expect((global as any).closeTab).not.toHaveBeenCalled();
    });

    it('closes a non-grouped tab when both grouped and non-grouped tabs exceed limit with ignoreCloseGroupedTabs=false', async () => {
      settingsOverrides = { ignoreCloseGroupedTabs: false };

      // 3 tabs in total — two grouped and one regular, all exceed limit of 2.
      const tabRegular = makeTab({ id: 1, url: 'https://regular.com', groupId: -1 });
      const tabGrouped1 = makeTab({ id: 2, url: 'https://grouped1.com', groupId: 5 });
      const tabGrouped2 = makeTab({ id: 3, url: 'https://grouped2.com', groupId: 5 });

      const windows = [{ id: 1, tabs: [tabRegular, tabGrouped1, tabGrouped2] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      [tabRegular, tabGrouped1, tabGrouped2].forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 100;
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      // All 3 tabs are eligible (ignoreCloseGroupedTabs=false means grouped tabs ARE included).
      // 3 > 2 limit → closeTab must be called.
      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8.3 — Rank formula selects the correct tab to close
  //
  // Rank = active_time² × (swch_cnt+1) - time × (parked ? time : 2)
  // Lower rank = higher priority to close.
  // ══════════════════════════════════════════════════════════════════════════
  describe('8.3 — Rank formula selects the lowest-rank tab for closure', () => {
    it('closes Tab A (rank -400) over Tab B (rank -200) when A has higher time', async () => {
      // Tab A: time=200, active_time=0, swch_cnt=0, parked=false
      //   rank = 0²×(0+1) - 200×2 = 0 - 400 = -400
      // Tab B: time=100, active_time=0, swch_cnt=0, parked=false
      //   rank = 0²×(0+1) - 100×2 = 0 - 200 = -200
      // Tab A has lower rank → Tab A should be closed.
      const tabA = makeTab({ id: 1, url: 'https://a.com' });
      const tabB = makeTab({ id: 2, url: 'https://b.com' });
      const tabC = makeTab({ id: 3, url: 'https://c.com' }); // third tab to push count > limit

      const windows = [{ id: 1, tabs: [tabA, tabB, tabC] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      const infoA = tabManager.getTabInfoOrCreate(tabA);
      infoA.time       = 200;
      infoA.active_time = 0;
      infoA.swch_cnt   = 0;
      infoA.parked     = false;

      const infoB = tabManager.getTabInfoOrCreate(tabB);
      infoB.time       = 100;
      infoB.active_time = 0;
      infoB.swch_cnt   = 0;
      infoB.parked     = false;

      const infoC = tabManager.getTabInfoOrCreate(tabC);
      infoC.time       = 100;
      infoC.active_time = 0;
      infoC.swch_cnt   = 0;
      infoC.parked     = false;

      await runTick(tabObserver);

      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
      // The first argument to closeTab is the tab id of the lowest-rank tab.
      expect((global as any).closeTab.mock.calls[0][0]).toBe(1);
    });

    it('closes the parked tab (rank = -time²) when it has a much lower rank', async () => {
      // Tab A: time=100, active_time=0, swch_cnt=0, parked=true
      //   rank = 0 - 100×100 = -10000  ← much lower
      // Tab B: time=100, active_time=0, swch_cnt=0, parked=false
      //   rank = 0 - 100×2  = -200
      // Tab A (parked) has lower rank → closed first.
      const tabA = makeTab({ id: 1, url: PARK_URL + '?url=https://a.com&tabId=1&sessionId=123456' });
      const tabB = makeTab({ id: 2, url: 'https://b.com' });
      const tabC = makeTab({ id: 3, url: 'https://c.com' });

      const windows = [{ id: 1, tabs: [tabA, tabB, tabC] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      const infoA = tabManager.getTabInfoOrCreate(tabA);
      infoA.time       = 100;
      infoA.active_time = 0;
      infoA.swch_cnt   = 0;
      infoA.parked     = true;  // parked → rank multiplier becomes tab.time

      const infoB = tabManager.getTabInfoOrCreate(tabB);
      infoB.time       = 100;
      infoB.active_time = 0;
      infoB.swch_cnt   = 0;
      infoB.parked     = false;

      const infoC = tabManager.getTabInfoOrCreate(tabC);
      infoC.time       = 100;
      infoC.active_time = 0;
      infoC.swch_cnt   = 0;
      infoC.parked     = false;

      await runTick(tabObserver);

      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
      expect((global as any).closeTab.mock.calls[0][0]).toBe(1);
    });

    it('closes the least-active tab (higher active_time raises rank, protecting it)', async () => {
      // Tab A: time=100, active_time=50, swch_cnt=2, parked=false
      //   rank = 50²×(2+1) - 100×2 = 7500 - 200 = 7300  ← high rank, NOT closed
      // Tab B: time=100, active_time=0, swch_cnt=0, parked=false
      //   rank = 0 - 200 = -200  ← lowest rank, CLOSED
      const tabA = makeTab({ id: 1, url: 'https://a.com' });
      const tabB = makeTab({ id: 2, url: 'https://b.com' });
      const tabC = makeTab({ id: 3, url: 'https://c.com' });

      const windows = [{ id: 1, tabs: [tabA, tabB, tabC] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      const infoA = tabManager.getTabInfoOrCreate(tabA);
      infoA.time       = 100;
      infoA.active_time = 50;
      infoA.swch_cnt   = 2;
      infoA.parked     = false;

      const infoB = tabManager.getTabInfoOrCreate(tabB);
      infoB.time       = 100;
      infoB.active_time = 0;
      infoB.swch_cnt   = 0;
      infoB.parked     = false;

      const infoC = tabManager.getTabInfoOrCreate(tabC);
      infoC.time       = 100;
      infoC.active_time = 50;
      infoC.swch_cnt   = 2;
      infoC.parked     = false;

      await runTick(tabObserver);

      expect((global as any).closeTab).toHaveBeenCalledTimes(1);
      // Tab B has lowest rank → it must be the one closed.
      expect((global as any).closeTab.mock.calls[0][0]).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8.5 — Total tabs ≤ limit → no tab is closed
  // ══════════════════════════════════════════════════════════════════════════
  describe('8.5 — Tab count at or below the limit does not trigger a close', () => {
    it('does NOT call closeTab when tab count equals limitOfOpenedTabs', async () => {
      // Limit is 2; provide exactly 2 tabs — count is not strictly greater, so no close.
      const tab1 = makeTab({ id: 1, url: 'https://a.com' });
      const tab2 = makeTab({ id: 2, url: 'https://b.com' });

      const windows = [{ id: 1, tabs: [tab1, tab2] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      [tab1, tab2].forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 100;
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      expect((global as any).closeTab).not.toHaveBeenCalled();
    });

    it('does NOT call closeTab when tab count is below limitOfOpenedTabs', async () => {
      // Limit is 2; only 1 tab — well within limit.
      const tab1 = makeTab({ id: 1, url: 'https://a.com' });

      const windows = [{ id: 1, tabs: [tab1] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      const info = tabManager.getTabInfoOrCreate(tab1);
      info.time       = 100;
      info.active_time = 0;
      info.swch_cnt   = 0;
      info.parked     = false;

      await runTick(tabObserver);

      expect((global as any).closeTab).not.toHaveBeenCalled();
    });

    it('does NOT call closeTab when isCloseTabsOn is false even with many tabs', async () => {
      settingsOverrides = { isCloseTabsOn: false };

      const tabs = [1, 2, 3, 4, 5].map(id =>
        makeTab({ id, url: `https://tab${id}.com` })
      );
      const windows = [{ id: 1, tabs }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      tabs.forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 100;
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      expect((global as any).closeTab).not.toHaveBeenCalled();
    });

    it('does NOT close any tab when all tabs have time < closeTimeout', async () => {
      // closeTimeout is 60; all tabs have time=50 — none qualify as close-candidates.
      const tab1 = makeTab({ id: 1, url: 'https://a.com' });
      const tab2 = makeTab({ id: 2, url: 'https://b.com' });
      const tab3 = makeTab({ id: 3, url: 'https://c.com' });

      const windows = [{ id: 1, tabs: [tab1, tab2, tab3] }];
      (chrome.windows.getAll as jest.Mock).mockImplementation((_opts: any, cb: any) => cb(windows));

      [tab1, tab2, tab3].forEach(tab => {
        const info = tabManager.getTabInfoOrCreate(tab);
        info.time       = 50; // below closeTimeout (60)
        info.active_time = 0;
        info.swch_cnt   = 0;
        info.parked     = false;
      });

      await runTick(tabObserver);

      // tabArray has 3 elements (> limit 2), but no tab reaches closeTimeout,
      // so minRankTab stays null and closeTab is never called.
      expect((global as any).closeTab).not.toHaveBeenCalled();
    });
  });
});
