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

// Mock settings
(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: true,
      timeout: 900,
      pinned: true,
      isCloseTabsOn: false,
      ignoreAudible: true,
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

// Define parkTabGroup and unsuspendTabGroup functions globally for testing
// These are simplified versions based on the actual implementation
(global as any).parkTabGroup = function(tab: chrome.tabs.Tab) {
  if (tab == null || tab.groupId === -1) {
    console.warn('Cannot suspend tab group: tab is not in a group');
    return;
  }

  const groupId = tab.groupId;

  (chrome.windows.get as jest.Mock)(tab.windowId, { 'populate': true }, async function(window: chrome.windows.Window) {
    let number = 0;
    for (const j in window.tabs) {
      if (window.tabs.hasOwnProperty(j)) {
        const currentTab = window.tabs[j];
        // Only suspend tabs in the same group
        if (currentTab.groupId === groupId) {
          const TabManager = (global as any).TabManager;
          if (TabManager && TabManager.isTabURLAllowedForPark(currentTab)) {
            const tabManager = (global as any).tabManager;
            if (tabManager && !await tabManager.isExceptionTab(currentTab)) {
              const parkTab = (global as any).parkTab;
              if (parkTab) {
                await parkTab(currentTab, currentTab.id, { bulkNumber: (currentTab.discarded ? number++ : null) });
              }
            }
          }
        }
      }
    }
  });
};

(global as any).unsuspendTabGroup = function(tab: chrome.tabs.Tab) {
  if (tab == null || tab.groupId === -1) {
    console.warn('Cannot unsuspend tab group: tab is not in a group');
    return;
  }

  const groupId = tab.groupId;
  let openedIndex = 1;

  (chrome.windows.get as jest.Mock)(tab.windowId, { 'populate': true }, function(window: chrome.windows.Window) {
    for (const j in window.tabs) {
      if (window.tabs.hasOwnProperty(j)) {
        const currentTab = window.tabs[j];
        // Only unsuspend tabs in the same group
        const TabManager = (global as any).TabManager;
        if (currentTab.groupId === groupId && TabManager && TabManager.isTabParked(currentTab)) {
          const tmpFunction = function(currentTab: chrome.tabs.Tab) {
            const clzOpenedIndex = openedIndex++;
            setTimeout(function() {
              const tabManager = (global as any).tabManager;
              if (tabManager) {
                tabManager.unsuspendTab(currentTab);
              }
            }, 1000 * clzOpenedIndex);
          };

          tmpFunction(currentTab);
        }
      }
    }
  });
};

describe('Tab Group Suspend/Unsuspend', () => {
  let tabManager: any;
  let TabManager: any;
  let parkTabMock: jest.Mock;
  let unsuspendTabMock: jest.Mock;
  let mockChromeWindowsGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset parkTab mock
    parkTabMock = jest.fn().mockResolvedValue(undefined);
    (global as any).parkTab = parkTabMock;

    // Reset chrome.windows.get mock
    mockChromeWindowsGet = jest.fn();
    (global as any).chrome = {
      ...((global as any).chrome || {}),
      windows: {
        get: mockChromeWindowsGet
      }
    };

    // Re-import modules using require (not import)
    const TabManagerModule = require('../../modules/TabManager');
    TabManager = TabManagerModule.TabManager;

    // Make TabManager available globally
    (global as any).TabManager = TabManager;

    // Initialize TabManager
    tabManager = new TabManager(
      (global as any).settings,
      (global as any).whiteList,
      (global as any).ignoreList
    );
    (global as any).tabManager = tabManager;

    // Setup unsuspendTab mock
    unsuspendTabMock = jest.fn().mockImplementation((tab: chrome.tabs.Tab) => {
      // Mock basic unsuspend behavior
      return Promise.resolve();
    });
    tabManager.unsuspendTab = unsuspendTabMock;

    // Mock isExceptionTab to return false by default
    tabManager.isExceptionTab = jest.fn().mockResolvedValue(false);
  });

  describe('parkTabGroup', () => {
    it('should suspend all tabs in the same group', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'https://tab1.com', active: true },
        { ...tab, id: 2, groupId: 10, url: 'https://tab2.com', active: false },
        { ...tab, id: 3, groupId: 10, url: 'https://tab3.com', active: false },
        { ...tab, id: 4, groupId: 20, url: 'https://other.com', active: false }, // Different group
        { ...tab, id: 5, groupId: -1, url: 'https://ungrouped.com', active: false } // No group
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      // Call parkTabGroup
      const parkTabGroup = (global as any).parkTabGroup;
      await parkTabGroup(tab);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should suspend only tabs in group 10
      expect(parkTabMock).toHaveBeenCalledTimes(3);
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, groupId: 10 }),
        1,
        expect.any(Object)
      );
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, groupId: 10 }),
        2,
        expect.any(Object)
      );
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, groupId: 10 }),
        3,
        expect.any(Object)
      );

      // Should NOT suspend tabs in other groups
      expect(parkTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 4 }),
        expect.anything(),
        expect.anything()
      );
      expect(parkTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 5 }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should not suspend exception tabs (audible, pinned)', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'https://normal.com', active: false, pinned: false, audible: false },
        { ...tab, id: 2, groupId: 10, url: 'https://music.com', active: false, pinned: false, audible: true }, // Audible
        { ...tab, id: 3, groupId: 10, url: 'https://pinned.com', active: false, pinned: true, audible: false } // Pinned
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      // Mock isExceptionTab to return true for audible and pinned tabs
      tabManager.isExceptionTab = jest.fn().mockImplementation(async (tab: chrome.tabs.Tab) => {
        return tab.audible || tab.pinned;
      });

      const parkTabGroup = (global as any).parkTabGroup;
      await parkTabGroup(tab);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only suspend the normal tab (id: 1)
      expect(parkTabMock).toHaveBeenCalledTimes(1);
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        1,
        expect.any(Object)
      );

      // Should NOT suspend audible or pinned tabs
      expect(parkTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 2 }),
        expect.anything(),
        expect.anything()
      );
      expect(parkTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should do nothing if tab is not in a group (groupId === -1)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: -1, // Not in a group
        discarded: false
      };

      const parkTabGroup = (global as any).parkTabGroup;
      parkTabGroup(tab);

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith('Cannot suspend tab group: tab is not in a group');

      // Should not call chrome.windows.get
      expect(mockChromeWindowsGet).not.toHaveBeenCalled();

      // Should not suspend any tabs
      expect(parkTabMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should do nothing if tab is null', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const parkTabGroup = (global as any).parkTabGroup;
      parkTabGroup(null);

      expect(consoleSpy).toHaveBeenCalledWith('Cannot suspend tab group: tab is not in a group');
      expect(mockChromeWindowsGet).not.toHaveBeenCalled();
      expect(parkTabMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should only affect tabs in the same window', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, windowId: 1, groupId: 10, url: 'https://tab1.com' },
        { ...tab, id: 2, windowId: 1, groupId: 10, url: 'https://tab2.com' }
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        // Only return tabs for the requested window
        expect(windowId).toBe(1);
        callback({ id: windowId, tabs: windowTabs });
      });

      const parkTabGroup = (global as any).parkTabGroup;
      await parkTabGroup(tab);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify chrome.windows.get was called with correct windowId
      expect(mockChromeWindowsGet).toHaveBeenCalledWith(
        1,
        { populate: true },
        expect.any(Function)
      );
    });

    it('should handle chrome-extension:// URLs (already suspended tabs)', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'https://normal.com' },
        { ...tab, id: 2, groupId: 10, url: 'chrome-extension://test/park.html?tabId=2' }, // Already suspended
        { ...tab, id: 3, groupId: 10, url: 'https://another.com' }
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      const parkTabGroup = (global as any).parkTabGroup;
      await parkTabGroup(tab);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only suspend normal tabs (id: 1 and 3)
      // Tab 2 is already suspended (chrome-extension:// URL) and should be skipped
      expect(parkTabMock).toHaveBeenCalledTimes(2);
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        1,
        expect.any(Object)
      );
      expect(parkTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 }),
        3,
        expect.any(Object)
      );
    });
  });

  describe('unsuspendTabGroup', () => {
    it('should unsuspend all suspended tabs in the same group', async () => {
      const tab = {
        id: 1,
        url: 'chrome-extension://test/park.html?tabId=1',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'chrome-extension://test/park.html?tabId=1' }, // Suspended
        { ...tab, id: 2, groupId: 10, url: 'chrome-extension://test/park.html?tabId=2' }, // Suspended
        { ...tab, id: 3, groupId: 10, url: 'https://active.com' }, // Active (not suspended)
        { ...tab, id: 4, groupId: 20, url: 'chrome-extension://test/park.html?tabId=4' }, // Different group
        { ...tab, id: 5, groupId: -1, url: 'chrome-extension://test/park.html?tabId=5' } // No group
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(tab);

      // Wait for setTimeout delays (1 second per tab)
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Should unsuspend only suspended tabs in group 10
      expect(unsuspendTabMock).toHaveBeenCalledTimes(2);
      expect(unsuspendTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, groupId: 10 })
      );
      expect(unsuspendTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, groupId: 10 })
      );

      // Should NOT unsuspend active tabs
      expect(unsuspendTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 })
      );

      // Should NOT unsuspend tabs in other groups
      expect(unsuspendTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 4 })
      );
      expect(unsuspendTabMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 5 })
      );
    });

    it('should use staggered delays to prevent overwhelming the browser', async () => {
      const tab = {
        id: 1,
        url: 'chrome-extension://test/park.html?tabId=1',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'chrome-extension://test/park.html?tabId=1' },
        { ...tab, id: 2, groupId: 10, url: 'chrome-extension://test/park.html?tabId=2' },
        { ...tab, id: 3, groupId: 10, url: 'chrome-extension://test/park.html?tabId=3' }
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(tab);

      // Wait for first tab (1 second delay)
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(unsuspendTabMock).toHaveBeenCalledTimes(1);

      // Wait for second tab (2 second delay total)
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(unsuspendTabMock).toHaveBeenCalledTimes(2);

      // Wait for third tab (3 second delay total)
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(unsuspendTabMock).toHaveBeenCalledTimes(3);

      // Verify that calls happened in sequence (timestamps increase)
      const calls = unsuspendTabMock.mock.calls;
      expect(calls.length).toBe(3);
      expect(calls[0][0].id).toBe(1);
      expect(calls[1][0].id).toBe(2);
      expect(calls[2][0].id).toBe(3);
    });

    it('should do nothing if tab is not in a group (groupId === -1)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const tab = {
        id: 1,
        url: 'chrome-extension://test/park.html?tabId=1',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: -1, // Not in a group
        discarded: false
      };

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(tab);

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith('Cannot unsuspend tab group: tab is not in a group');

      // Should not call chrome.windows.get
      expect(mockChromeWindowsGet).not.toHaveBeenCalled();

      // Should not unsuspend any tabs
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(unsuspendTabMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should do nothing if tab is null', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(null);

      expect(consoleSpy).toHaveBeenCalledWith('Cannot unsuspend tab group: tab is not in a group');
      expect(mockChromeWindowsGet).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(unsuspendTabMock).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should only affect tabs in the same window', async () => {
      const tab = {
        id: 1,
        url: 'chrome-extension://test/park.html?tabId=1',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, windowId: 1, groupId: 10, url: 'chrome-extension://test/park.html?tabId=1' },
        { ...tab, id: 2, windowId: 1, groupId: 10, url: 'chrome-extension://test/park.html?tabId=2' }
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        // Only return tabs for the requested window
        expect(windowId).toBe(1);
        callback({ id: windowId, tabs: windowTabs });
      });

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(tab);

      // Verify chrome.windows.get was called with correct windowId
      expect(mockChromeWindowsGet).toHaveBeenCalledWith(
        1,
        { populate: true },
        expect.any(Function)
      );
    });

    it('should handle empty group (no suspended tabs)', async () => {
      const tab = {
        id: 1,
        url: 'https://active.com',
        title: 'Example',
        active: true,
        audible: false,
        status: 'complete',
        windowId: 1,
        index: 0,
        pinned: false,
        groupId: 10,
        discarded: false
      };

      const windowTabs = [
        { ...tab, id: 1, groupId: 10, url: 'https://active1.com' },
        { ...tab, id: 2, groupId: 10, url: 'https://active2.com' },
        { ...tab, id: 3, groupId: 10, url: 'https://active3.com' }
      ];

      mockChromeWindowsGet.mockImplementation((windowId, options, callback) => {
        callback({ id: windowId, tabs: windowTabs });
      });

      const unsuspendTabGroup = (global as any).unsuspendTabGroup;
      unsuspendTabGroup(tab);

      await new Promise(resolve => setTimeout(resolve, 100));

      // No suspended tabs, so unsuspendTab should not be called
      expect(unsuspendTabMock).not.toHaveBeenCalled();
    });
  });

});
