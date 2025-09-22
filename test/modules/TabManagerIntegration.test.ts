// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock global variables and functions before importing
(global as any).sessionsPageUrl = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl = 'chrome-extension://test/history.html';
(global as any).parkUrl = 'chrome-extension://test/park.html';
(global as any).trace = false;
(global as any).debug = false;
(global as any).debugScreenCache = false;
(global as any).TSSessionId = 123456;
(global as any).getScreenCache = null;

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

// Mock global objects
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

(global as any).ContextMenuController = {
  menuIdMap: {}
};

(global as any).pauseTics = 0;

(global as any).ScreenshotController = {
  getScreen: jest.fn()
};

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn()
}));

const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(),
  onTabUpdate: jest.fn(),
  onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn()
}));

const TabObserver = {
  tickSize: 1000
};

// Make classes available globally
(global as any).BrowserActionControl = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;
(global as any).TabObserver = TabObserver;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('TabManager Integration Tests', () => {
  let tabManager: any;
  let TabManager: any;
  let TabInfo: any;

  // Chrome event callbacks
  let onCreatedCallback: (tab: chrome.tabs.Tab) => void;
  let onReplacedCallback: (addedTabId: number, removedTabId: number) => void;
  let onUpdatedCallback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
  let onRemovedCallback: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
  let onActivatedCallback: (activeInfo: chrome.tabs.TabActiveInfo) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Clear global variables
    (global as any).getScreenCache = null;
    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    // Setup Chrome event listeners capture
    (global as any).chrome.tabs.onCreated.addListener = jest.fn((callback) => {
      onCreatedCallback = callback;
    });
    (global as any).chrome.tabs.onReplaced.addListener = jest.fn((callback) => {
      onReplacedCallback = callback;
    });
    (global as any).chrome.tabs.onUpdated.addListener = jest.fn((callback) => {
      onUpdatedCallback = callback;
    });
    (global as any).chrome.tabs.onRemoved.addListener = jest.fn((callback) => {
      onRemovedCallback = callback;
    });
    (global as any).chrome.tabs.onActivated.addListener = jest.fn((callback) => {
      onActivatedCallback = callback;
    });

    // Re-import modules
    const TabInfoModule = require('../../modules/model/TabInfo');
    TabInfo = TabInfoModule.TabInfo;

    // Make TabInfo available globally
    (global as any).TabInfo = TabInfo;

    const TabManagerModule = require('../../modules/TabManager');
    TabManager = TabManagerModule.TabManager;

    tabManager = new TabManager();
  });

  describe('Chrome Events Integration', () => {
    it('should handle tab creation event', async () => {
      const newTab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        pinned: false,
        discarded: false,
        autoDiscardable: true,
        audible: false,
        groupId: -1,
        status: 'complete',
        highlighted: false,
        incognito: false,
        selected: true
      };

      // Trigger onCreated event
      onCreatedCallback(newTab);

      // Should create TabInfo
      const tabInfo = tabManager.getTabInfoById(1);
      expect(tabInfo).toBeDefined();
      expect(tabInfo.id).toBe(1);
      expect(tabInfo.lstCapUrl).toBe('https://example.com');

      // Should call checkAndTurnOffAutoDiscardable
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, { autoDiscardable: false });
    });

    it('should handle tab replacement event', async () => {
      const originalTab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com/page1',
        title: 'Page 1',
        active: true,
        pinned: false,
        discarded: false,
        autoDiscardable: true,
        audible: false,
        groupId: -1,
        status: 'complete',
        highlighted: false,
        incognito: false,
        selected: true
      };

      // Create original tab
      onCreatedCallback(originalTab);

      // Mock chrome.tabs.get for replacement scenario
      (global as any).chrome.tabs.get = jest.fn((tabId, callback) => {
        if (tabId === 2) {
          callback({
            id: 2,
            url: 'chrome-extension://test/park.html?tabId=1&url=https://example.com/page1'
          });
        }
      });

      // Trigger replacement event (2 replaces 1)
      onReplacedCallback(2, 1);

      // Check that replacement was handled correctly
      const replacedTabInfo = tabManager.getTabInfoById(2);
      expect(replacedTabInfo).toBeDefined();
      expect(replacedTabInfo.oldRefId).toBe(1);

      const originalTabInfo = tabManager.getTabInfoById(1);
      expect(originalTabInfo.newRefId).toBe(2);
    });

    it('should handle tab update event', async () => {
      const tab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        pinned: false,
        discarded: false,
        autoDiscardable: true,
        audible: false,
        groupId: -1,
        status: 'complete',
        highlighted: false,
        incognito: false,
        selected: true
      };

      // Create tab first
      onCreatedCallback(tab);

      // Trigger update event
      const changeInfo = { status: 'complete', title: 'Updated Title' };
      onUpdatedCallback(1, changeInfo, { ...tab, title: 'Updated Title' });

      const tabInfo = tabManager.getTabInfoById(1);
      expect(tabInfo.nonCmpltInput).toBe(false);
    });

    it('should handle tab removal event', async () => {
      const tab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        active: false,
        pinned: false,
        discarded: false,
        autoDiscardable: true,
        audible: false,
        groupId: -1,
        status: 'complete',
        highlighted: false,
        incognito: false,
        selected: false
      };

      // Create tab first
      onCreatedCallback(tab);

      // Trigger removal event
      onRemovedCallback(1, { windowId: 1, isWindowClosing: false });

      const tabInfo = tabManager.getTabInfoById(1);
      expect(tabInfo.closed).toBeDefined();
      expect(tabInfo.closed.at).toBe(1640995200000);
    });

  });

});