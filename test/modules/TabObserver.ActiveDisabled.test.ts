// Test: auto-suspension is fully disabled when settings.active = false
import '../lib/Chrome';
import '../typing/global.d';

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
  try {
    return new URL(url).searchParams.get(param);
  } catch {
    return null;
  }
});

(global as any).extractHostname = jest.fn((url: string) => {
  try { return new URL(url).hostname; } catch { return ''; }
});

(global as any).discardTab = jest.fn();
(global as any).markForUnsuspend = jest.fn();
(global as any).parkTab = jest.fn();

let mockActiveValue = true;

(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: mockActiveValue,
      timeout: 30,           // very short timeout: 30 sec
      pinned: false,
      isCloseTabsOn: false,
      ignoreAudible: false,
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: false,
      enableSuspendOnlyIfBattLvlLessValue: false,
      adaptiveSuspendTimeout: false,
      ignoreCloseGroupedTabs: false,
      ignoreSuspendGroupedTabs: false,
      discardTimeoutFactor: 0.05,
      battLvlLessValue: 50,
    };
    return Promise.resolve(key in defaults ? defaults[key] : false);
  })
};

(global as any).whiteList = { isURIException: jest.fn().mockReturnValue(false) };
(global as any).ignoreList = { isTabInIgnoreTabList: jest.fn().mockReturnValue(false) };
(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).ContextMenuController = { menuIdMap: {} };
(global as any).ScreenshotController = { getScreen: jest.fn() };

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn(),
  synchronizeActiveTabs: jest.fn()
}));
const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(), onTabUpdate: jest.fn(), onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn()
}));
(global as any).BrowserActionControl = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;

const inactiveTab = {
  id: 10,
  url: 'https://example.com',
  title: 'Some Tab',
  active: false,
  audible: false,
  status: 'complete',
  windowId: 1,
  index: 0,
  pinned: false,
  groupId: -1,
  discarded: false,
  favIconUrl: 'https://example.com/favicon.ico'
};

describe('TabObserver - active: false disables auto-suspension', () => {
  let tabManager: any;
  let tabObserver: any;
  let TabObserverClass: any;
  let TabManager: any;
  let TabInfo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockActiveValue = true;
    (global as any).parkTab = jest.fn();
    (global as any).pauseTics = 0;

    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const TabInfoModule = require('../../modules/model/TabInfo');
    TabInfo = TabInfoModule.TabInfo;
    (global as any).TabInfo = TabInfo;

    const TabManagerModule = require('../../modules/TabManager');
    TabManager = TabManagerModule.TabManager;
    (global as any).TabManager = TabManager;

    require('../../modules/TabObserver');
    TabObserverClass = (global as any).TabObserver || eval('TabObserver');

    tabManager = new TabManager();

    (global as any).chrome.windows.getAll = jest.fn((options, callback) => {
      callback([{ id: 1, focused: true, tabs: [inactiveTab] }]);
    });
  });

  it('should suspend tab when active=true and time >= timeout (baseline)', async () => {
    mockActiveValue = true;
    tabObserver = new TabObserverClass(tabManager);

    // 4 ticks × 10s = 40s > 30s timeout → suspension expected
    for (let i = 0; i < 4; i++) {
      await tabObserver.tick(false);
    }

    expect((global as any).parkTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: inactiveTab.id }),
      inactiveTab.id
    );
  });

  it('should NOT suspend tab when active=false, even if time exceeds timeout', async () => {
    mockActiveValue = false;
    tabObserver = new TabObserverClass(tabManager);

    // Same 4 ticks — but active=false must prevent suspension
    for (let i = 0; i < 4; i++) {
      await tabObserver.tick(false);
    }

    expect((global as any).parkTab).not.toHaveBeenCalled();
  });

  it('should stop suspending immediately when active switches from true to false mid-session', async () => {
    mockActiveValue = true;
    tabObserver = new TabObserverClass(tabManager);

    // 2 ticks × 10s = 20s — time accumulates but stays below the 30s threshold
    for (let i = 0; i < 2; i++) {
      await tabObserver.tick(false);
    }

    // Disable auto-suspension before threshold is reached
    mockActiveValue = false;
    (global as any).parkTab.mockClear();

    // Run many more ticks — even though accumulated time would exceed timeout,
    // active=false must prevent any suspension
    for (let i = 0; i < 10; i++) {
      await tabObserver.tick(false);
    }

    expect((global as any).parkTab).not.toHaveBeenCalled();
  });

  it('should NOT accumulate tab time when active=false', async () => {
    mockActiveValue = false;
    tabObserver = new TabObserverClass(tabManager);

    for (let i = 0; i < 10; i++) {
      await tabObserver.tick(false);
    }

    const tabInfo = tabManager.getTabInfoById(inactiveTab.id);
    // With active=false, tick() returns early, so time must stay at 0
    expect(tabInfo == null || tabInfo.time === 0).toBe(true);
  });
});
