// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock global variables and functions before importing
(global as any).sessionsPageUrl = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl = 'chrome-extension://test/history.html';
(global as any).parkUrl = 'chrome-extension://test/park.html';
(global as any).publicExtensionUrl = 'chrome-extension://test/park.html';
(global as any).trace = false;
(global as any).debug = false;
(global as any).debugTabsInfo = false;
(global as any).debugScreenCache = false;
(global as any).TSSessionId = 123456;
(global as any).getScreenCache = null;
(global as any).pauseTics = 0;
(global as any).isCharging = false;
(global as any).batteryLevel = 1.0;

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  const urlParams = new URLSearchParams(url.split('?')[1]);
  return urlParams.get(param);
});

(global as any).extractHostname = jest.fn((url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
});

(global as any).discardTab = jest.fn();
(global as any).markForUnsuspend = jest.fn();
(global as any).parkTab = jest.fn();

// Mock global objects
let mockIgnoreAudible = true; // Can be changed per test

(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: true,
      timeout: 900, // 15 minutes in seconds
      pinned: true,
      isCloseTabsOn: false,
      ignoreAudible: mockIgnoreAudible, // Protect audible tabs (can be changed)
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: false,
      enableSuspendOnlyIfBattLvlLessValue: false,
      adaptiveSuspendTimeout: false,
      ignoreCloseGroupedTabs: false,
      ignoreSuspendGroupedTabs: false,
      autoRestoreTab: true
    };
    return Promise.resolve(defaults[key] ?? false);
  })
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

(global as any).ContextMenuController = {
  menuIdMap: {}
};

(global as any).ScreenshotController = {
  getScreen: jest.fn()
};

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn(),
  synchronizeActiveTabs: jest.fn()
}));

const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(),
  onTabUpdate: jest.fn(),
  onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn()
}));

// Make classes available globally
(global as any).BrowserActionControl = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;

describe('TabObserver - Active Tab with Audible Bug', () => {
  let tabManager: any;
  let TabManager: any;
  let TabInfo: any;
  let tabObserver: any;
  let TabObserverClass: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset mockIgnoreAudible to default
    mockIgnoreAudible = true;

    // Clear global variables
    (global as any).getScreenCache = null;
    (global as any).parkTab = jest.fn();
    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    // Re-import modules
    const TabInfoModule = require('../../modules/model/TabInfo');
    TabInfo = TabInfoModule.TabInfo;

    // Make TabInfo available globally
    (global as any).TabInfo = TabInfo;

    const TabManagerModule = require('../../modules/TabManager');
    TabManager = TabManagerModule.TabManager;

    // Make TabManager available globally (required by TabObserver)
    (global as any).TabManager = TabManager;

    // Load TabObserver module - it defines TabObserver class globally
    require('../../modules/TabObserver');

    // Get TabObserver from global scope (it's defined without export/import as per project rules)
    TabObserverClass = (global as any).TabObserver || eval('TabObserver');

    // Create TabManager instance
    tabManager = new TabManager();

    // Mock chrome.windows.getAll to return our test tabs
    (global as any).chrome.windows.getAll = jest.fn();
  });

  /**
   * BUG REPRODUCTION TEST #1:
   *
   * Scenario:
   * 1. User has TWO tabs open: Tab A (currently active, no audio) and Tab B (inactive, playing music)
   * 2. User works on Tab A for 15+ minutes
   * 3. Tab B (with music) is inactive but audible, accumulating suspension time
   * 4. After 15 minutes, Tab B's tabInfo.time >= 900 seconds
   * 5. Next tick: Tab B gets suspended despite playing audio!
   *
   * Expected: Tab playing audio should NOT be suspended even if inactive for 15+ minutes
   * Actual: Background tab with audio accumulates time and gets suspended
   */
  it('should NOT suspend INACTIVE tab playing audio after 15+ minutes', async () => {
    // Setup: Two tabs - one active (no audio), one inactive (playing music)
    const activeTab = {
      id: 1,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: true,  // User is on this tab
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    const inactiveAudibleTab = {
      id: 2,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: false,  // Tab is in background
      audible: true,  // But music is playing!
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    // Mock chrome.windows.getAll to return our tabs
    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      callback([{
        id: 1,
        focused: true,
        tabs: [activeTab, inactiveAudibleTab]
      }]);
    });

    // Create TabObserver
    tabObserver = new TabObserverClass(tabManager);

    // Simulate 90 ticks (90 * 10 seconds = 900 seconds = 15 minutes)
    // Inactive tab with audio should accumulate time BUT should NOT be suspended
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);
    }

    // Get the tabInfo for the inactive audible tab
    const tabInfo = tabManager.getTabInfoById(inactiveAudibleTab.id);

    // The tab has accumulated time (it's inactive)
    console.log('Inactive audible tab time after 90 ticks:', tabInfo.time);

    // Clear the parkTab mock to track new calls
    (global as any).parkTab.mockClear();

    // Run one more tick
    await tabObserver.tick(false);

    // EXPECTED: Tab should NOT be suspended because it's playing audio (audible=true)
    // and ignoreAudible setting is true (protect audible tabs)
    expect((global as any).parkTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: inactiveAudibleTab.id }),
      inactiveAudibleTab.id
    );
  });

  /**
   * BUG REPRODUCTION TEST #2 - THE REAL USER BUG!
   *
   * Scenario (EXACT user scenario):
   * 1. User is on an ACTIVE tab playing music (audible=true)
   * 2. User stays on this tab for 15+ minutes (working, listening to music)
   * 3. TabObserver.tick() runs every 10 seconds, incrementing tabInfo.time for ALL tabs (including active!) ← BUG!
   * 4. After 15 minutes, tabInfo.time >= 900 seconds (timeout threshold)
   * 5. User switches to another tab (tab.active becomes false)
   * 6. Next tick (10 seconds later): Tab is suspended DESPITE playing audio!
   *
   * Root Cause:
   * - Line 193: `tabInfo.time += TabObserver.tickSize;` has NO check for `!tab.active`
   * - Active tabs accumulate suspension time, which is WRONG
   * - When user switches away, tab has time >= 900 and gets suspended immediately
   * - Line 255-256 resets time for audible tabs, but this happens AFTER suspend check!
   *
   * Expected: Active tab should NOT accumulate suspension time
   * Actual: Active tab DOES accumulate time, leading to immediate suspension when user switches away
   */
  it('BUG: Active tab accumulates suspension time and gets suspended when user switches (USER SCENARIO)', async () => {
    // Setup: User is on a tab playing music
    const musicTab = {
      id: 1,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: true,  // User is currently on this tab!
      audible: true, // Music is playing
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    const workTab = {
      id: 2,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: false,
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    let tickCount = 0;

    // Mock chrome.windows.getAll
    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      tickCount++;

      // For ticks 1-90: User is on music tab
      if (tickCount <= 90) {
        callback([{
          id: 1,
          focused: true,
          tabs: [musicTab, workTab]
        }]);
      }
      // Tick 91+: User switched to work tab
      else {
        callback([{
          id: 1,
          focused: true,
          tabs: [
            { ...musicTab, active: false },  // Music tab now inactive
            { ...workTab, active: true }      // Work tab now active
          ]
        }]);
      }
    });

    // Create TabObserver
    tabObserver = new TabObserverClass(tabManager);

    // Simulate 90 ticks (15 minutes) - user is on the music tab
    // BUG: Even though tab is ACTIVE, time is being accumulated!
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);
    }

    // Get tabInfo for music tab
    const tabInfo = tabManager.getTabInfoById(musicTab.id);

    //ОЖИДАНИЕ БАГА: Активная вкладка НЕ должна накопить время, но накапливает!
    // Если time >= 900, значит баг есть (активная вкладка накапливает время)
    // Если time === 0, значит фикс работает (строка 255-256 или правильная проверка !tab.active)
    console.log('Music tab time after 90 ticks (while ACTIVE):', tabInfo.time);

    // Clear parkTab mock
    (global as any).parkTab.mockClear();

    // User switches to another tab - next tick happens 10 seconds later
    await tabObserver.tick(false);

    // CHECK: Was music tab suspended?
    const wasSuspended = (global as any).parkTab.mock.calls.some(
      call => call[1] === musicTab.id
    );

    console.log('Was music tab suspended after switch?', wasSuspended);
    console.log('parkTab calls:', (global as any).parkTab.mock.calls);

    // THIS IS THE BUG THE USER EXPERIENCED:
    // If time accumulated while tab was active (time >= 900),
    // and line 255-256 doesn't protect it early enough,
    // then tab will be suspended despite playing audio!
    //
    // The test expects suspension to NOT happen (that's the correct behavior)
    // But with current bug, suspension WILL happen
    expect((global as any).parkTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: musicTab.id }),
      musicTab.id
    );
  });

  /**
   * BUG REPRODUCTION TEST #3: Race condition with tab.audible
   *
   * Scenario:
   * 1. User has a tab playing music in background for 15+ minutes
   * 2. Chrome's tab.audible property is briefly FALSE during chrome.windows.getAll() call
   * 3. TabObserver.tick() checks isExceptionTab() - returns FALSE because audible=false
   * 4. Tab gets suspended!
   * 5. Later in same tick, line 255 checks audible again - but too late, tab already suspended
   *
   * Expected: Tab should NOT be suspended even if audible status is temporarily incorrect
   * Actual: Tab gets suspended due to race condition
   */
  it('should NOT suspend tab if audible status is temporarily FALSE (race condition)', async () => {
    const activeTab = {
      id: 1,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: true,
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    const musicTab = {
      id: 2,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: false,
      audible: true,  // Music is playing!
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    let tickCount = 0;

    // Mock chrome.windows.getAll
    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      tickCount++;

      // Simulate race condition: on tick #91, audible is temporarily FALSE
      if (tickCount === 91) {
        callback([{
          id: 1,
          focused: true,
          tabs: [activeTab, { ...musicTab, audible: false }]  // BUG: audible temporarily false!
        }]);
      } else {
        callback([{
          id: 1,
          focused: true,
          tabs: [activeTab, musicTab]
        }]);
      }
    });

    tabObserver = new TabObserverClass(tabManager);

    // Accumulate time for 90 ticks
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);
    }

    const tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('Music tab time after 90 ticks:', tabInfo.time);

    // Clear parkTab mock
    (global as any).parkTab.mockClear();

    // Tick #91: audible is temporarily FALSE - tab gets suspended!
    await tabObserver.tick(false);

    // AFTER FIX: Tab should NOT be suspended because fix prevents time accumulation
    // Even with race condition (audible temporarily false), time doesn't accumulate
    expect((global as any).parkTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: musicTab.id }),
      musicTab.id
    );
  });

  /**
   * BUG TEST #4: ignoreAudible setting is DISABLED
   *
   * Scenario:
   * 1. User has disabled "ignore audible tabs" setting (ignoreAudible=false)
   * 2. User is on a tab playing music for 15+ minutes
   * 3. Active tab accumulates time (BUG!)
   * 4. User switches away
   * 5. Tab gets suspended immediately!
   *
   * This reproduces the user's bug if they had the setting disabled
   */
  it('BUG: Active audible tab gets suspended if ignoreAudible setting is disabled', async () => {
    // Disable audible protection
    mockIgnoreAudible = false;

    const musicTab = {
      id: 1,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: true,
      audible: true,
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    const workTab = {
      id: 2,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: false,
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    let tickCount = 0;

    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      tickCount++;

      if (tickCount <= 90) {
        callback([{
          id: 1,
          focused: true,
          tabs: [musicTab, workTab]
        }]);
      } else {
        callback([{
          id: 1,
          focused: true,
          tabs: [
            { ...musicTab, active: false },
            { ...workTab, active: true }
          ]
        }]);
      }
    });

    tabObserver = new TabObserverClass(tabManager);

    // 90 ticks - user on music tab
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);

      if (i % 10 === 0) {
        const info = tabManager.getTabInfoById(musicTab.id);
        console.log(`[Tick ${i}] tab.active=${musicTab.active}, tab.audible=${musicTab.audible}, tabInfo.time=${info.time}`);
      }
    }

    const tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('[ignoreAudible=false] Music tab time after 90 ticks:', tabInfo.time);

    // AFTER FIX: Even with ignoreAudible=false, active tabs don't accumulate time
    // So time should be 0 (protected by !tab.active check in fix)
    expect(tabInfo.time).toBe(0);

    (global as any).parkTab.mockClear();

    // User switches away
    await tabObserver.tick(false);

    // AFTER FIX: Tab NOT suspended because time never accumulated
    expect((global as any).parkTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: musicTab.id }),
      musicTab.id
    );
  });

  /**
   * BUG TEST #5: THE REAL BUG - Tab accumulated time BEFORE user activated it!
   *
   * TRUE Scenario:
   * 1. Tab with music is INACTIVE in background for 15+ minutes, accumulates time >= 900
   * 2. User switches TO this tab, listens to music for a while
   * 3. Line 338 resets time to 0 while tab is active
   * 4. User switches AWAY from the tab after a short time (e.g., 1 minute)
   * 5. Tab is inactive again, starts accumulating time: 10, 20, 30...
   * 6. After just 10 seconds: time=10, but tab gets suspended!
   *
   * WHY? Because isExceptionTab() check might fail if:
   * - tab.audible is temporarily false
   * - or ignoreAudible setting is false
   * - or some other race condition
   *
   * The REAL fix: time should NOT accumulate for INACTIVE tabs either if they're audible!
   * OR: Line 255-256 should be BEFORE the suspend check, not after!
   */
  it('REAL BUG: Tab opened long ago, user briefly activates it, switches away, gets suspended immediately', async () => {
    const musicTab = {
      id: 1,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: false,  // Initially inactive
      audible: true,
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    const workTab = {
      id: 2,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: true,  // Initially active
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    let tickCount = 0;

    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      tickCount++;

      // Ticks 1-90: Music tab INACTIVE in background (but audible!)
      if (tickCount <= 90) {
        callback([{
          id: 1,
          focused: true,
          tabs: [musicTab, workTab]
        }]);
      }
      // Ticks 91-96: User switches TO music tab (6 ticks = 60 seconds)
      else if (tickCount <= 96) {
        callback([{
          id: 1,
          focused: true,
          tabs: [
            { ...musicTab, active: true },   // Now active!
            { ...workTab, active: false }
          ]
        }]);
      }
      // Tick 97+: User switches AWAY from music tab
      else {
        callback([{
          id: 1,
          focused: true,
          tabs: [
            { ...musicTab, active: false },  // Back to inactive
            { ...workTab, active: true }
          ]
        }]);
      }
    });

    tabObserver = new TabObserverClass(tabManager);

    // Phase 1: 90 ticks with music tab INACTIVE (but audible)
    // Line 255-256 should reset time to 0 each tick
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);
    }

    let tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('[Phase 1] Music tab time after 90 ticks (INACTIVE, audible):', tabInfo.time);

    // Phase 2: 6 ticks with music tab ACTIVE
    // Line 338 should reset time to 0 each tick
    for (let i = 0; i < 6; i++) {
      await tabObserver.tick(false);
    }

    tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('[Phase 2] Music tab time after activation (ACTIVE, audible):', tabInfo.time);

    (global as any).parkTab.mockClear();

    // Phase 3: User switches away - FIRST tick after switch
    await tabObserver.tick(false);

    tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('[Phase 3] Music tab time after 1 tick (INACTIVE again):', tabInfo.time);

    // BUG: If line 255-256 doesn't execute (for any reason),
    // tab will have time=10 and might be suspended if conditions align
    const wasSuspended = (global as any).parkTab.mock.calls.some(
      call => call[1] === musicTab.id
    );
    console.log('Was music tab suspended?', wasSuspended);

    // Tab should NOT be suspended (audible protection should work)
    expect((global as any).parkTab).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: musicTab.id }),
      musicTab.id
    );
  });

  /**
   * BUG TEST #6: **THE ACTUAL BUG** - Race condition in SAME tick!
   *
   * Critical Issue:
   * TabObserver.tick() execution order:
   * 1. Line 193: tabInfo.time += 10
   * 2. Line 217: isExceptionTab(tab) checks tab.audible → IF FALSE, suspend!
   * 3. Line 255: if (audible) time = 0 → TOO LATE!
   *
   * If Chrome's tab object has audible=false at line 217, but we KNOW music is playing,
   * the tab gets suspended before line 255 can protect it!
   *
   * This is the REAL bug user experienced!
   */
  it('**ACTUAL BUG**: tab.audible temporarily false at suspend check, tab gets suspended despite playing audio', async () => {
    // Disable audible protection to see the pure bug
    // (Even with ignoreAudible=true, if tab.audible is false, protection fails!)
    mockIgnoreAudible = true;

    const musicTab = {
      id: 1,
      url: 'https://music.example.com',
      title: 'Music Player',
      active: false,
      audible: false,  // ← BUG: Chrome API reports false even though music plays!
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false,
      favIconUrl: 'https://music.example.com/favicon.ico'
    };

    const workTab = {
      id: 2,
      url: 'https://work.example.com',
      title: 'Work Tab',
      active: true,
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      callback([{
        id: 1,
        focused: true,
        tabs: [musicTab, workTab]
      }]);
    });

    tabObserver = new TabObserverClass(tabManager);

    // Accumulate time for 90 ticks (tab.audible=false, so time is NOT reset by line 255-256)
    for (let i = 0; i < 90; i++) {
      await tabObserver.tick(false);
    }

    const tabInfo = tabManager.getTabInfoById(musicTab.id);
    console.log('[Bug Test] Music tab time after 90 ticks (audible=false reported):', tabInfo.time);

    // Time should have accumulated to 900 because tab.audible=false
    expect(tabInfo.time).toBeGreaterThanOrEqual(900);

    (global as any).parkTab.mockClear();

    // Next tick: tab gets suspended!
    await tabObserver.tick(false);

    // THIS IS THE BUG: Tab was suspended even though music was actually playing
    // Chrome just reported tab.audible=false (API bug or timing issue)
    expect((global as any).parkTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: musicTab.id }),
      musicTab.id
    );

    console.log('✓ BUG REPRODUCED: Tab with playing audio suspended due to tab.audible=false');
  });

  it('should NOT increment time for active tabs (the fix)', async () => {
    // This test verifies the fix: time should only increment for inactive tabs
    const activeTab = {
      id: 1,
      url: 'https://example.com',
      title: 'Active Tab',
      active: true,  // This tab is active
      audible: false,
      status: 'complete',
      windowId: 1,
      index: 0,
      pinned: false,
      groupId: -1,
      discarded: false
    };

    (chrome.windows.getAll as jest.Mock).mockImplementation((options, callback) => {
      callback([{
        id: 1,
        focused: true,
        tabs: [activeTab]
      }]);
    });

    tabObserver = new TabObserverClass(tabManager);

    // Run multiple ticks
    for (let i = 0; i < 10; i++) {
      await tabObserver.tick(false);
    }

    const tabInfo = tabManager.getTabInfoById(activeTab.id);

    // With the fix: active tab should NOT have accumulated time
    // Without the fix: tabInfo.time would be 100 (10 ticks * 10 seconds)
    expect(tabInfo.time).toBe(0);
  });
});
