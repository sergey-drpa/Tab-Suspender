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

describe('TabManager', () => {
  let tabManager: any;
  let TabManager: any;
  let TabInfo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Clear global variables
    (global as any).getScreenCache = null;
    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    // Re-import modules
    const TabInfoModule = require('../../modules/model/TabInfo');
    TabInfo = TabInfoModule.TabInfo;

    // Make TabInfo available globally
    (global as any).TabInfo = TabInfo;

    const TabManagerModule = require('../../modules/TabManager');
    TabManager = TabManagerModule.TabManager;

    tabManager = new TabManager();

    // Make tabManager available globally
    (global as any).tabManager = tabManager;
  });

  describe('Constructor', () => {
    it('should initialize TabManager with default values', () => {
      expect(tabManager).toBeDefined();
      expect(tabManager.historyOpenerController).toBeDefined();
      expect(chrome.tabs.onCreated.addListener).toHaveBeenCalled();
      expect(chrome.tabs.onReplaced.addListener).toHaveBeenCalled();
      expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();
      expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
      expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled();
    });

    it('should start common loop on initialization', () => {
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 10000);
    });
  });

  describe('Compression/Decompression', () => {
    it('should compress and decompress strings correctly', async () => {
      const testString = 'Hello, World!';
      const compressed = await tabManager.compress(testString);
      const decompressed = await tabManager.decompress(compressed);

      expect(compressed).toBeDefined();
      expect(decompressed).toBe(testString);
    });
  });

  describe('Base64 Conversion', () => {
    it('should convert ArrayBuffer to base64 and back', () => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 72; // 'H'
      view[1] = 101; // 'e'

      const base64 = tabManager.arrayBufferToBase64(buffer);
      const convertedBack = tabManager.base64ToArrayBuffer(base64);

      expect(base64).toBeDefined();
      expect(convertedBack).toBeInstanceOf(ArrayBuffer);
      expect(convertedBack.byteLength).toBe(buffer.byteLength); // Should match original
    });

    // 12.5 — chunked path (> 8 KB) must roundtrip correctly
    it('12.5 — arrayBufferToBase64 → base64ToArrayBuffer roundtrip is lossless for buffers > 8 KB', () => {
      const size = 20 * 1024; // 20 KB — forces chunked processing (chunkSize = 8192)
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = i % 256;

      const base64 = tabManager.arrayBufferToBase64(original.buffer);
      const restored = new Uint8Array(tabManager.base64ToArrayBuffer(base64));

      expect(restored.byteLength).toBe(size);
      // Verify every byte survived the roundtrip
      for (let i = 0; i < size; i++) {
        if (restored[i] !== original[i]) {
          throw new Error(`Byte mismatch at index ${i}: expected ${original[i]}, got ${restored[i]}`);
        }
      }
    });

    it('12.5 — chunked path produces same result as small-buffer path at boundary (8192 bytes)', () => {
      // Exactly at the boundary: both paths should give identical output
      const exactBoundary = new Uint8Array(8192);
      for (let i = 0; i < 8192; i++) exactBoundary[i] = i % 256;

      const base64Boundary = tabManager.arrayBufferToBase64(exactBoundary.buffer);
      const restored = new Uint8Array(tabManager.base64ToArrayBuffer(base64Boundary));

      expect(restored.byteLength).toBe(8192);
      for (let i = 0; i < 8192; i++) expect(restored[i]).toBe(exactBoundary[i]);
    });

    it('should perform arrayBufferToBase64 conversion within reasonable time', () => {
      // Test with different buffer sizes to measure performance characteristics
      const testSizes = [1024, 10240, 102400, 1048576]; // 1KB, 10KB, 100KB, 1MB

      testSizes.forEach(size => {
        // Create test buffer with random data
        const buffer = new ArrayBuffer(size);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < size; i++) {
          view[i] = Math.floor(Math.random() * 256);
        }

        const iterations = size > 100000 ? 10 : 100; // Fewer iterations for larger buffers
        const times: number[] = [];

        // Warm up
        for (let i = 0; i < 3; i++) {
          tabManager.arrayBufferToBase64(buffer);
        }

        // Measure performance
        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          const result = tabManager.arrayBufferToBase64(buffer);
          const end = performance.now();
          times.push(end - start);

          // Verify result is valid
          expect(result).toBeDefined();
          expect(typeof result).toBe('string');
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log(`ArrayBuffer ${size} bytes: avg=${avgTime.toFixed(2)}ms, min=${minTime.toFixed(2)}ms, max=${maxTime.toFixed(2)}ms`);

        // Performance thresholds (these may need adjustment based on hardware)
        if (size <= 1024) {
          expect(avgTime).toBeLessThan(1); // 1KB should be very fast
        } else if (size <= 10240) {
          expect(avgTime).toBeLessThan(10); // 10KB should be fast
        } else if (size <= 102400) {
          expect(avgTime).toBeLessThan(50); // 100KB should be reasonable
        } else {
          expect(avgTime).toBeLessThan(500); // 1MB might be slower but should be under 500ms
        }
      });
    });

    it('should perform base64ToArrayBuffer conversion within reasonable time', () => {
      // Test with different base64 string sizes
      const testSizes = [1024, 10240, 102400, 1048576]; // 1KB, 10KB, 100KB, 1MB

      testSizes.forEach(size => {
        // Create test buffer and convert to base64 for testing
        const originalBuffer = new ArrayBuffer(size);
        const view = new Uint8Array(originalBuffer);
        for (let i = 0; i < size; i++) {
          view[i] = Math.floor(Math.random() * 256);
        }
        const base64String = tabManager.arrayBufferToBase64(originalBuffer);

        const iterations = size > 100000 ? 10 : 100; // Fewer iterations for larger buffers
        const times: number[] = [];

        // Warm up
        for (let i = 0; i < 3; i++) {
          tabManager.base64ToArrayBuffer(base64String);
        }

        // Measure performance
        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          const result = tabManager.base64ToArrayBuffer(base64String);
          const end = performance.now();
          times.push(end - start);

          // Verify result is valid
          expect(result).toBeDefined();
          expect(result).toBeInstanceOf(ArrayBuffer);
          expect(result.byteLength).toBe(size);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log(`Base64 ${size} bytes: avg=${avgTime.toFixed(2)}ms, min=${minTime.toFixed(2)}ms, max=${maxTime.toFixed(2)}ms`);

        // Performance thresholds (these may need adjustment based on hardware)
        if (size <= 1024) {
          expect(avgTime).toBeLessThan(1); // 1KB should be very fast
        } else if (size <= 10240) {
          expect(avgTime).toBeLessThan(10); // 10KB should be fast
        } else if (size <= 102400) {
          expect(avgTime).toBeLessThan(50); // 100KB should be reasonable
        } else {
          expect(avgTime).toBeLessThan(500); // 1MB might be slower but should be under 500ms
        }
      });
    });
  });

  describe('Tab Info Management', () => {
    const mockTab: chrome.tabs.Tab = {
      id: 1,
      windowId: 1,
      index: 0,
      url: 'https://example.com',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
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

    it('should create new tab info', () => {
      const tabInfo = tabManager.createNewTabInfo(mockTab);

      expect(tabInfo).toBeDefined();
      expect(tabInfo.id).toBe(mockTab.id);
      expect(tabInfo.winId).toBe(mockTab.windowId);
      expect(tabInfo.lstCapUrl).toBe(mockTab.url);
      expect(tabInfo.discarded).toBe(mockTab.discarded);
    });

    it('should get existing tab info by id', () => {
      tabManager.createNewTabInfo(mockTab);
      const retrievedTabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(retrievedTabInfo).toBeDefined();
      expect(retrievedTabInfo.id).toBe(mockTab.id);
    });

    it('should return undefined for non-existing tab info', () => {
      const retrievedTabInfo = tabManager.getTabInfoById(999);
      expect(retrievedTabInfo).toBeUndefined();
    });

    it('should get or create tab info', () => {
      const tabInfo = tabManager.getTabInfoOrCreate(mockTab);

      expect(tabInfo).toBeDefined();
      expect(tabInfo.id).toBe(mockTab.id);

      // Should return same instance on second call
      const tabInfo2 = tabManager.getTabInfoOrCreate(mockTab);
      expect(tabInfo2).toBe(tabInfo);
    });
  });

  describe('Tab State Management', () => {
    const mockTab: chrome.tabs.Tab = {
      id: 1,
      windowId: 1,
      index: 0,
      url: 'https://example.com',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
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

    beforeEach(() => {
      tabManager.createNewTabInfo(mockTab);
    });

    it('should mark tab as activated', () => {
      const fixedTime = 1640995200000;
      ((global as any).Date.now as jest.Mock).mockReturnValue(fixedTime);

      tabManager.markTabActivated(mockTab);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(tabInfo.lstSwchTime).toBe(fixedTime);
      expect(tabInfo.swch_cnt).toBe(1);
      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
    });

    it('should mark tab as parked', () => {
      tabManager.markTabParked(mockTab);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(tabInfo.parked).toBe(true);
      expect(tabInfo.parkedUrl).toBe(mockTab.url);
      expect(tabInfo.parkedCount).toBe(1);
    });

    it('should set tab as unsuspended', () => {
      tabManager.setTabUnsuspended(mockTab);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(tabInfo.time).toBe(0);
      expect(tabInfo.suspended_time).toBe(0);
      expect(tabInfo.parkTrys).toBe(0);
    });

    it('should set last capture URL and time', () => {
      const fixedTime = 1640995200000;
      ((global as any).Date.now as jest.Mock).mockReturnValue(fixedTime);

      tabManager.setLastCaptureUrl(mockTab);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(tabInfo.lstCapUrl).toBe(mockTab.url);
      expect(tabInfo.lstCapTime).toBe(fixedTime);
    });
  });

  describe('Tab Replacement Detection', () => {
    it('should handle tab replacement correctly', () => {
      const originalTab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        favIconUrl: 'https://example.com/favicon.ico',
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

      tabManager.createNewTabInfo(originalTab);
      const replacedTabInfo = tabManager.onTabReplaceDetected(2, 1);

      expect(replacedTabInfo).toBeDefined();
      expect(replacedTabInfo.id).toBe(2);
      expect(replacedTabInfo.oldRefId).toBe(1);

      const originalTabInfo = tabManager.getTabInfoById(1);
      expect(originalTabInfo.newRefId).toBe(2);
    });
  });

  describe('Tab Closure Management', () => {
    const mockTab: chrome.tabs.Tab = {
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

    beforeEach(() => {
      tabManager.createNewTabInfo(mockTab);
    });

    it('should mark tab as closed', () => {
      const fixedTime = 1640995200000;
      ((global as any).Date.now as jest.Mock).mockReturnValue(fixedTime);

      tabManager.markTabClosed(mockTab.id);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);

      expect(tabInfo.closed).toBeDefined();
      expect(tabInfo.closed.at).toBe(fixedTime);
      expect(tabInfo.closed.tsSessionId).toBe(TSSessionId);
    });

    it('should clear closed tabs after TTL', () => {
      const currentTime = 1640995200000;
      const expiredTime = currentTime - (25 * 60 * 60 * 1000); // 25 hours ago

      // Set tab as closed in the past
      tabManager.markTabClosed(mockTab.id);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      tabInfo.closed.at = expiredTime;

      // Mock current time to be after TTL
      ((global as any).Date.now as jest.Mock).mockReturnValue(currentTime);

      tabManager.clearClosedTabs();

      // Tab should be deleted
      const retrievedTabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(retrievedTabInfo).toBeUndefined();
    });

    it('should not clear closed tabs before TTL', () => {
      const currentTime = 1640995200000;
      const recentTime = currentTime - (1 * 60 * 60 * 1000); // 1 hour ago

      // Set tab as closed recently
      tabManager.markTabClosed(mockTab.id);
      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      tabInfo.closed.at = recentTime;

      // Mock current time
      ((global as any).Date.now as jest.Mock).mockReturnValue(currentTime);

      tabManager.clearClosedTabs();

      // Tab should still exist
      const retrievedTabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(retrievedTabInfo).toBeDefined();
    });
  });

  describe('Static Methods', () => {
    const httpTab: chrome.tabs.Tab = {
      id: 1,
      url: 'http://example.com',
      windowId: 1,
      index: 0,
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

    const httpsTab: chrome.tabs.Tab = {
      id: 2,
      url: 'https://example.com',
      windowId: 1,
      index: 1,
      active: false,
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

    const chromeStoreTab: chrome.tabs.Tab = {
      id: 3,
      url: 'https://chrome.google.com/webstore/detail/test',
      windowId: 1,
      index: 2,
      active: false,
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

    const parkedTab: chrome.tabs.Tab = {
      id: 4,
      url: 'chrome-extension://test/park.html?url=https://example.com',
      windowId: 1,
      index: 3,
      active: false,
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

    it('should correctly identify tabs allowed for parking', () => {
      expect(TabManager.isTabURLAllowedForPark(httpTab)).toBe(true);
      expect(TabManager.isTabURLAllowedForPark(httpsTab)).toBe(true);
      expect(TabManager.isTabURLAllowedForPark(chromeStoreTab)).toBe(false);
    });

    it('should correctly identify tabs that can be scripted', () => {
      expect(TabManager.canTabBeScripted(httpTab)).toBe(true);
      expect(TabManager.canTabBeScripted(httpsTab)).toBe(true);
      expect(TabManager.canTabBeScripted(chromeStoreTab)).toBe(false);
    });

    it('should correctly identify parked tabs', () => {
      expect(TabManager.isTabParked(httpTab)).toBe(false);
      expect(TabManager.isTabParked(httpsTab)).toBe(false);
      expect(TabManager.isTabParked(parkedTab)).toBe(true);
    });

    it('should correctly identify audible tabs', () => {
      const audibleTab = { ...httpTab, audible: true };
      const silentTab = { ...httpTab, audible: false };

      expect(TabManager.isAudible(audibleTab)).toBe(true);
      expect(TabManager.isAudible(silentTab)).toBe(false);
    });

    it('should correctly check grouped tabs rules', () => {
      const groupedTab = { ...httpTab, groupId: 1 };
      const ungroupedTab = { ...httpTab, groupId: -1 };

      expect(TabManager.isPassGroupedTabsRules(ungroupedTab, false)).toBe(true);
      expect(TabManager.isPassGroupedTabsRules(ungroupedTab, true)).toBe(true);
      expect(TabManager.isPassGroupedTabsRules(groupedTab, false)).toBe(true);
      expect(TabManager.isPassGroupedTabsRules(groupedTab, true)).toBe(false);
    });

    it('should extract URL parameters correctly', () => {
      const url = 'https://example.com?param1=value1&param2=value2';

      expect(TabManager.getParameterByName('param1', url)).toBe('value1');
      expect(TabManager.getParameterByName('param2', url)).toBe('value2');
      expect(TabManager.getParameterByName('param3', url)).toBeNull();
    });
  });

  describe('Exception Detection', () => {
    const mockTab: chrome.tabs.Tab = {
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

    beforeEach(() => {
      tabManager.createNewTabInfo(mockTab);
    });

    it('should detect audible tab exception', async () => {
      const audibleTab = { ...mockTab, audible: true };
      (global as any).settings.get.mockResolvedValueOnce(true); // ignoreAudible = true

      const isException = await tabManager.isExceptionTab(audibleTab);
      expect(isException).toBe(true);
    });

    it('should detect pinned tab exception', async () => {
      const pinnedTab = { ...mockTab, pinned: true };
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'ignoreAudible') return Promise.resolve(false);
        if (key === 'pinned') return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const isException = await tabManager.isExceptionTab(pinnedTab);
      expect(isException).toBe(true);
    });

    it('should detect ignored tab exception', async () => {
      (global as any).settings.get.mockResolvedValue(false);
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValueOnce(true);

      const isException = await tabManager.isExceptionTab(mockTab);
      expect(isException).toBe(true);
    });

    it('should detect whitelist exception', async () => {
      (global as any).settings.get.mockResolvedValue(false);
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValue(false);
      (global as any).whiteList.isURIException.mockReturnValueOnce(true);

      const isException = await tabManager.isExceptionTab(mockTab);
      expect(isException).toBe(true);
    });

    it('should detect grouped tab exception', async () => {
      const groupedTab = { ...mockTab, groupId: 1 };
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'ignoreSuspendGroupedTabs') return Promise.resolve(true);
        return Promise.resolve(false);
      });
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValue(false);
      (global as any).whiteList.isURIException.mockReturnValue(false);

      const isException = await tabManager.isExceptionTab(groupedTab);
      expect(isException).toBe(true);
    });

    it('should not detect grouped tab exception when setting is disabled', async () => {
      const groupedTab = { ...mockTab, groupId: 1 };
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'ignoreSuspendGroupedTabs') return Promise.resolve(false);
        return Promise.resolve(false);
      });
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValue(false);
      (global as any).whiteList.isURIException.mockReturnValue(false);

      const isException = await tabManager.isExceptionTab(groupedTab);
      expect(isException).toBe(false);
    });

    it('should not detect grouped tab exception for ungrouped tabs', async () => {
      const ungroupedTab = { ...mockTab, groupId: -1 };
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'ignoreSuspendGroupedTabs') return Promise.resolve(true);
        return Promise.resolve(false);
      });
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValue(false);
      (global as any).whiteList.isURIException.mockReturnValue(false);

      const isException = await tabManager.isExceptionTab(ungroupedTab);
      expect(isException).toBe(false);
    });

    it('should not detect exception for normal tab', async () => {
      (global as any).settings.get.mockResolvedValue(false);
      (global as any).ignoreList.isTabInIgnoreTabList.mockReturnValue(false);
      (global as any).whiteList.isURIException.mockReturnValue(false);

      const isException = await tabManager.isExceptionTab(mockTab);
      expect(isException).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should initialize with window and tab data', () => {
      const mockInitOptions = { reloadSettings: false };

      tabManager.init(mockInitOptions);

      expect(chrome.windows.getAll).toHaveBeenCalledWith(
        { 'populate': true },
        expect.any(Function)
      );
    });
  });

  describe('Tab Suspension', () => {
    const mockTab: chrome.tabs.Tab = {
      id: 1,
      windowId: 1,
      index: 0,
      url: 'chrome-extension://test/park.html?url=https://example.com',
      title: 'Example',
      active: true,
      pinned: false,
      discarded: true,
      autoDiscardable: true,
      audible: false,
      groupId: -1,
      status: 'complete',
      highlighted: false,
      incognito: false,
      selected: true
    };

    it('should unsuspend discarded tab', () => {
      tabManager.unsuspendTab(mockTab);

      expect(global.markForUnsuspend).toHaveBeenCalledWith(mockTab);
      expect(chrome.tabs.reload).toHaveBeenCalledWith(mockTab.id);
    });

    it.skip('should handle non-discarded tab restoration based on settings', async () => {
      // This test involves complex promise chains that are difficult to mock properly
      // Skip for now as the main unsuspend functionality is tested above
      const nonDiscardedTab = { ...mockTab, discarded: false, status: 'loading' };

      // Mock the settings promise chain
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'reloadTabOnRestore') return Promise.resolve(true);
        return Promise.resolve(false);
      });

      tabManager.unsuspendTab(nonDiscardedTab);

      // Wait a bit longer for promise resolution
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(chrome.tabs.update).toHaveBeenCalledWith(
        nonDiscardedTab.id,
        { 'url': 'https://example.com' }
      );
    }, 10000); // Increase timeout to 10 seconds
  });

  describe('Auto-discardable Management', () => {
    it('should turn off auto-discardable for tabs', () => {
      const autoDiscardableTab = {
        id: 1,
        autoDiscardable: true
      };

      tabManager.checkAndTurnOffAutoDiscardable(autoDiscardableTab);

      expect(chrome.tabs.update).toHaveBeenCalledWith(
        autoDiscardableTab.id,
        { autoDiscardable: false }
      );
    });

    it('should not modify tabs that are not auto-discardable', () => {
      const nonAutoDiscardableTab = {
        id: 1,
        autoDiscardable: false
      };

      tabManager.checkAndTurnOffAutoDiscardable(nonAutoDiscardableTab);

      expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  describe('Test Configuration Methods', () => {
    it('should allow setting tab info cleanup TTL for tests', () => {
      const newTtl = 5000;
      tabManager.setTabInfoCleanupTtlMs(newTtl);

      // Create and immediately close a tab to test TTL
      const mockTab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        favIconUrl: 'https://example.com/favicon.ico',
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

      tabManager.createNewTabInfo(mockTab);
      tabManager.markTabClosed(mockTab.id);

      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      tabInfo.closed.at = Date.now() - (newTtl + 1000);

      tabManager.clearClosedTabs();

      const retrievedTabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(retrievedTabInfo).toBeUndefined();
    });

    it('should allow setting common loop period for tests', () => {
      const newPeriod = 5000;
      tabManager.setCommonLoopPeriodMs(newPeriod);

      expect(clearInterval).toHaveBeenCalled();
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), newPeriod);
    });

    it('should return copy of tab infos for tests', () => {
      const mockTab: chrome.tabs.Tab = {
        id: 1,
        windowId: 1,
        index: 0,
        url: 'https://example.com',
        title: 'Example',
        favIconUrl: 'https://example.com/favicon.ico',
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

      tabManager.createNewTabInfo(mockTab);
      const tabInfosCopy = tabManager.getTabInfosCopy();

      expect(tabInfosCopy).toBeDefined();
      expect(typeof tabInfosCopy).toBe('object');
      expect(tabInfosCopy).not.toBe(tabManager.tabInfos);
    });
  });

  describe('Missing Tab Detection with Grace Period', () => {
    const mockTab: chrome.tabs.Tab = {
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

    beforeEach(() => {
      tabManager.createNewTabInfo(mockTab);
    });

    it('should set missingCheckTime on first missing detection', () => {
      const fixedTime = 1640995200000;
      ((global as any).Date.now as jest.Mock).mockReturnValue(fixedTime);

      const openedChromeTabs = {}; // Empty - tab is missing
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(tabInfo.missingCheckTime).toBe(fixedTime);
      expect(tabInfo.closed).toBeUndefined();
    });

    it('should not mark tab as closed during grace period', () => {
      const startTime = 1640995200000;
      const duringGracePeriod = startTime + 15000; // 15 seconds later (within 30s grace period)

      // First detection - set missing time
      ((global as any).Date.now as jest.Mock).mockReturnValue(startTime);
      const openedChromeTabs = {};
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      // Second check during grace period
      ((global as any).Date.now as jest.Mock).mockReturnValue(duringGracePeriod);
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(tabInfo.missingCheckTime).toBe(startTime);
      expect(tabInfo.closed).toBeUndefined();
    });

    it('should mark tab as closed after grace period expires', () => {
      const startTime = 1640995200000;
      const afterGracePeriod = startTime + 31000; // 31 seconds later (after 30s grace period)

      // First detection - set missing time
      ((global as any).Date.now as jest.Mock).mockReturnValue(startTime);
      const openedChromeTabs = {};
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      // Second check after grace period
      ((global as any).Date.now as jest.Mock).mockReturnValue(afterGracePeriod);
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      const tabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(tabInfo.missingCheckTime).toBeNull();
      expect(tabInfo.closed).toBeDefined();
      expect(tabInfo.closed.at).toBe(afterGracePeriod);
      expect(tabInfo.closed.tsSessionId).toBe(TSSessionId);
    });

    it('should clear missingCheckTime when tab reappears', () => {
      const fixedTime = 1640995200000;
      ((global as any).Date.now as jest.Mock).mockReturnValue(fixedTime);

      // First detection - tab missing
      const emptyChromeTabs = {};
      tabManager.calculateAndMarkClosedTabs(emptyChromeTabs);

      let tabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(tabInfo.missingCheckTime).toBe(fixedTime);

      // Second detection - tab reappears
      const openedChromeTabs = { [mockTab.id]: mockTab };
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      tabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(tabInfo.missingCheckTime).toBeNull();
      expect(tabInfo.closed).toBeUndefined();
    });

    it('should handle suspended tabs correctly', () => {
      const suspendedTab: chrome.tabs.Tab = {
        ...mockTab,
        id: 2,
        url: 'chrome-extension://test/park.html?url=https://example.com&tabId=1'
      };

      tabManager.createNewTabInfo(suspendedTab);

      const openedChromeTabs = { [suspendedTab.id]: suspendedTab };
      tabManager.calculateAndMarkClosedTabs(openedChromeTabs);

      // Original tab (1) should not be marked as missing since it's suspended as tab (2)
      const originalTabInfo = tabManager.getTabInfoById(mockTab.id);
      expect(originalTabInfo.missingCheckTime).toBeNull();
    });
  });

  describe('Disable Screenshots Functionality', () => {
    let TabCapture: any;
    let ScreenshotController: any;

    beforeEach(() => {
      // Re-import modules
      const TabCaptureModule = require('../../modules/TabCapture');
      TabCapture = TabCaptureModule.TabCapture;

      const ScreenshotControllerModule = require('../../modules/ScreenshotController');
      ScreenshotController = ScreenshotControllerModule.ScreenshotController;
    });

    it('should have screenshotsEnabled setting defaulted to true', () => {
      expect(DEFAULT_SETTINGS.screenshotsEnabled).toBe(true);
    });


    it('should return null from ScreenshotController when screenshots are disabled', async () => {
      // Mock settings.get to return false for screenshotsEnabled
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'screenshotsEnabled') return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const mockCallback = jest.fn();

      // Call getScreen
      await ScreenshotController.getScreen(1, 123456, mockCallback);

      // Verify callback was called with null (no screenshot)
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    afterEach(() => {
      // Reset settings mock to default behavior
      (global as any).settings.get.mockResolvedValue(true);
    });
  });

  // ─── Issue #4 — parkedUrl fallback and TabInfo preservation ──────────────
  describe('Issue #4 — parkedUrl fallback and TabInfo preservation', () => {
    describe('TabManager.isInvalidRestoreUrl', () => {
      it('treats null/undefined/empty as invalid', () => {
        expect(TabManager.isInvalidRestoreUrl(null)).toBe(true);
        expect(TabManager.isInvalidRestoreUrl(undefined)).toBe(true);
        expect(TabManager.isInvalidRestoreUrl('')).toBe(true);
      });

      it('treats about:blank / about:newtab / chrome://newtab/ as invalid', () => {
        expect(TabManager.isInvalidRestoreUrl('about:blank')).toBe(true);
        expect(TabManager.isInvalidRestoreUrl('about:newtab')).toBe(true);
        expect(TabManager.isInvalidRestoreUrl('chrome://newtab/')).toBe(true);
      });

      it('treats real URLs as valid', () => {
        expect(TabManager.isInvalidRestoreUrl('https://example.com')).toBe(false);
        expect(TabManager.isInvalidRestoreUrl('http://example.com/page?id=1')).toBe(false);
        expect(TabManager.isInvalidRestoreUrl('https://example.com/?group=1&tab=1')).toBe(false);
      });
    });

    describe('onTabReplaceDetected — preserves TabInfo class on intermediate entry', () => {
      it('keeps toObject() on the closed intermediate entry (regression: structuredClone stripped it)', () => {
        const originTab: chrome.tabs.Tab = {
          id: 1, windowId: 1, index: 0, url: 'https://example.com',
          title: 'Example', favIconUrl: 'https://example.com/favicon.ico',
          active: true, pinned: false, discarded: false, autoDiscardable: true,
          audible: false, groupId: -1, status: 'complete',
          highlighted: false, incognito: false, selected: true
        };
        tabManager.createNewTabInfo(originTab);

        // Park.html URL whose tabId param differs from removedTabId -> intermediate branch.
        const parkTabUrl = `${(global as any).parkUrl}?tabId=999&url=${encodeURIComponent('https://example.com')}`;
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...originTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });

        const replaced = tabManager.onTabReplaceDetected(2, 1);

        expect(replaced).toBeDefined();
        expect(replaced.id).toBe(2);

        // The intermediate entry under removedTabId=1 must still be a TabInfo
        // class instance with a working toObject() method. structuredClone used
        // to turn it into a plain object and strip toObject(), which caused
        // BGMessageListener to throw.
        const intermediate = tabManager.getTabInfoById(1);
        expect(intermediate).toBeDefined();
        expect(typeof intermediate.toObject).toBe('function');
        expect(intermediate.toObject()).toBeInstanceOf(Object);
        expect(intermediate.oldRefId).toBe(999);
      });
    });

    describe('onTabReplaceDetected — repairs stale parkedUrl from park.html URL', () => {
      it('overwrites null parkedUrl with the url= param from the live park.html URL', () => {
        const originalTab: chrome.tabs.Tab = {
          id: 1, windowId: 1, index: 0, url: 'https://example.com',
          title: 'Example', active: true, pinned: false, discarded: false,
          autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
          highlighted: false, incognito: false, selected: true
        };
        const tabInfo = tabManager.createNewTabInfo(originalTab);
        // Simulate the broken post-restore state: parkedUrl lost.
        tabInfo.parkedUrl = null;

        // Origin tabId param matches removedTabId -> origin branch (not intermediate).
        const parkTabUrl = `${(global as any).parkUrl}?tabId=1&url=${encodeURIComponent('https://example.com/page?x=1')}`;
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...originalTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });

        const replaced = tabManager.onTabReplaceDetected(2, 1);

        expect(replaced.parkedUrl).toBe('https://example.com/page?x=1');
      });

      it('does not overwrite a valid parkedUrl', () => {
        const originalTab: chrome.tabs.Tab = {
          id: 1, windowId: 1, index: 0, url: 'https://example.com/real',
          title: 'Example', active: true, pinned: false, discarded: false,
          autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
          highlighted: false, incognito: false, selected: true
        };
        const tabInfo = tabManager.createNewTabInfo(originalTab);
        tabInfo.parkedUrl = 'https://example.com/real';

        const parkTabUrl = `${(global as any).parkUrl}?tabId=1&url=${encodeURIComponent('https://example.com/different')}`;
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...originalTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });

        const replaced = tabManager.onTabReplaceDetected(2, 1);

        expect(replaced.parkedUrl).toBe('https://example.com/real');
      });
    });

    describe('getTabInfoOrCreate — repairs stale parkedUrl before replace chain', () => {
      it('repairs null parkedUrl on the existing old-id entry from the live park.html url= param', () => {
        const oldTabId = 1;
        const originalUrl = 'https://example.com/page?keep=1';
        const parkTabUrl = `${(global as any).parkUrl}?tabId=${oldTabId}&url=${encodeURIComponent(originalUrl)}`;

        // Pre-populate tabInfos[oldTabId] with null parkedUrl (broken state).
        const staleInfo = new TabInfo({ id: oldTabId, url: originalUrl } as chrome.tabs.Tab);
        staleInfo.parkedUrl = null;
        tabManager.tabInfos[oldTabId] = staleInfo;

        // Live tab has a new id but the park.html URL still references oldTabId.
        const liveTab: chrome.tabs.Tab = {
          id: 2, windowId: 1, index: 0, url: parkTabUrl,
          title: 'Example', active: true, pinned: false, discarded: false,
          autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
          highlighted: false, incognito: false, selected: true
        };
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...liveTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });

        const result = tabManager.getTabInfoOrCreate(liveTab);

        // The old-id entry should have its parkedUrl repaired from the park.html URL.
        const repaired = tabManager.getTabInfoById(oldTabId);
        expect(repaired.parkedUrl).toBe(originalUrl);
        expect(result.id).toBe(2);
      });
    });

    describe('unsuspendTab — validates restore URL via resolveValidRestoreUrl fallbacks', () => {
      const makeParkTab = (url: string, tabId = 1): chrome.tabs.Tab => ({
        id: tabId, windowId: 1, index: 0,
        url: `${(global as any).parkUrl}?tabId=${tabId}&url=${encodeURIComponent(url)}`,
        title: 'Parked', active: true, pinned: false, discarded: false,
        autoDiscardable: true, audible: false, groupId: -1, status: 'loading',
        highlighted: false, incognito: false, selected: true
      });

      beforeEach(() => {
        // reloadTabOnRestore=true forces the resolveValidRestoreUrl path.
        (global as any).settings.get.mockImplementation((key: string) => {
          if (key === 'reloadTabOnRestore') return Promise.resolve(true);
          return Promise.resolve(false);
        });
      });

      afterEach(() => {
        (global as any).settings.get.mockResolvedValue(false);
      });

      it('uses the url= query param when valid', async () => {
        const tab = makeParkTab('https://example.com/page');
        tabManager.createNewTabInfo(tab);

        await tabManager.unsuspendTab(tab);

        expect(chrome.tabs.update).toHaveBeenCalledWith(tab.id, { url: 'https://example.com/page' });
      });

      it('falls back to tabInfo.parkedUrl when url= is blank', async () => {
        const tab = makeParkTab('about:blank');
        const info = tabManager.createNewTabInfo(tab);
        info.parkedUrl = 'https://example.com/parked-fallback';

        await tabManager.unsuspendTab(tab);

        expect(chrome.tabs.update).toHaveBeenCalledWith(tab.id, { url: 'https://example.com/parked-fallback' });
      });

      it('falls back to tabInfo.lstCapUrl when url= and parkedUrl are both invalid', async () => {
        const tab = makeParkTab('about:blank');
        const info = tabManager.createNewTabInfo(tab);
        info.parkedUrl = null;
        info.lstCapUrl = 'https://example.com/lstCap-fallback';

        await tabManager.unsuspendTab(tab);

        expect(chrome.tabs.update).toHaveBeenCalledWith(tab.id, { url: 'https://example.com/lstCap-fallback' });
      });

      it('aborts navigation (no chrome.tabs.update) when no valid URL is available', async () => {
        const tab = makeParkTab('about:blank');
        const info = tabManager.createNewTabInfo(tab);
        info.parkedUrl = null;
        info.lstCapUrl = '';

        (chrome.tabs.update as jest.Mock).mockClear();

        await tabManager.unsuspendTab(tab);

        expect(chrome.tabs.update).not.toHaveBeenCalled();
      });
    });

    describe('onUpdated — reverts parked tab when Chrome replaces URL with about:blank', () => {
      const onUpdatedListener = () => (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];

      const makeParkedTabInfo = (tabId: number, parkedUrl: string): any => {
        const info = new TabInfo({ id: tabId, url: parkedUrl } as chrome.tabs.Tab);
        info.parked = true;
        info.parkedUrl = parkedUrl;
        tabManager.tabInfos[tabId] = info;
        return info;
      };

      afterEach(() => {
        (chrome.tabs.update as jest.Mock).mockClear();
      });

      it('reverts to park.html with original URL when changeInfo.url is about:blank', () => {
        const tabId = 42;
        const originalUrl = 'https://example.com/original?page=1';
        makeParkedTabInfo(tabId, originalUrl);

        const blankTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'about:blank',
          title: 'Example', active: false, pinned: false, discarded: true,
          autoDiscardable: true, audible: false, groupId: 1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'about:blank' }, blankTab);

        expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
        const [calledTabId, updateObj] = (chrome.tabs.update as jest.Mock).mock.calls[0];
        expect(calledTabId).toBe(tabId);
        expect(updateObj.url.startsWith((global as any).parkUrl)).toBe(true);
        expect(updateObj.url).toContain(`tabId=${tabId}`);
        expect(updateObj.url).toContain(`url=${encodeURIComponent(originalUrl)}`);
      });

      it('reverts when changeInfo.url is chrome://newtab/', () => {
        const tabId = 43;
        makeParkedTabInfo(tabId, 'https://example.com/page');

        const newtabTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'chrome://newtab/',
          title: 'New Tab', active: false, pinned: false, discarded: true,
          autoDiscardable: true, audible: false, groupId: 1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'chrome://newtab/' }, newtabTab);

        expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
        const [, updateObj] = (chrome.tabs.update as jest.Mock).mock.calls[0];
        expect(updateObj.url).toContain(`url=${encodeURIComponent('https://example.com/page')}`);
      });

      it('falls back to lstCapUrl when parkedUrl is null', () => {
        const tabId = 44;
        const info = makeParkedTabInfo(tabId, 'https://example.com/initial');
        info.parkedUrl = null;
        info.lstCapUrl = 'https://example.com/lstCap';

        const blankTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'about:blank',
          title: '', active: false, pinned: false, discarded: true,
          autoDiscardable: true, audible: false, groupId: 1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'about:blank' }, blankTab);

        expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
        const [, updateObj] = (chrome.tabs.update as jest.Mock).mock.calls[0];
        expect(updateObj.url).toContain(`url=${encodeURIComponent('https://example.com/lstCap')}`);
      });

      it('does NOT revert when tab is not parked', () => {
        const tabId = 45;
        // Create a non-parked tabInfo (parked=false)
        const info = new TabInfo({ id: tabId, url: 'https://example.com' } as chrome.tabs.Tab);
        tabManager.tabInfos[tabId] = info;

        const blankTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'about:blank',
          title: '', active: false, pinned: false, discarded: true,
          autoDiscardable: true, audible: false, groupId: -1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'about:blank' }, blankTab);

        expect(chrome.tabs.update).not.toHaveBeenCalled();
      });

      it('does NOT revert when no valid URL is recoverable', () => {
        const tabId = 46;
        const info = makeParkedTabInfo(tabId, 'https://example.com/initial');
        info.parkedUrl = null;
        info.lstCapUrl = '';

        const blankTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'about:blank',
          title: '', active: false, pinned: false, discarded: true,
          autoDiscardable: true, audible: false, groupId: 1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'about:blank' }, blankTab);

        expect(chrome.tabs.update).not.toHaveBeenCalled();
      });

      it('DOES revert when tab is not discarded (Issue #4 — blank grouped parked tab activated by user)', () => {
        const tabId = 48;
        makeParkedTabInfo(tabId, 'https://example.com/parked');

        // After Chrome session restore, a grouped parked tab's URL is replaced
        // with about:blank BEFORE the service worker starts. When the user
        // later activates that blank tab, Chrome fires onUpdated WITHOUT a
        // changeInfo.url entry (the URL did not change — it was already blank)
        // and tab.discarded=false. The revert MUST fire via the tab.url check
        // so the user sees park.html instead of a blank tab. goBack() then uses
        // window.location.replace(originalUrl) (restoredFromStorage path) so we
        // do NOT loop back to about:blank.
        const blankTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'about:blank',
          title: '', active: true, pinned: false, discarded: false,
          autoDiscardable: true, audible: false, groupId: 1, status: 'loading',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { status: 'loading' }, blankTab);

        const calls = (chrome.tabs.update as jest.Mock).mock.calls;
        const parkUrlCall = calls.find(([id, obj]: [number, { url?: string }]) =>
          obj?.url?.startsWith((global as any).parkUrl));
        expect(parkUrlCall).toBeDefined();
        expect(parkUrlCall?.[1]?.url).toContain('url=' + encodeURIComponent('https://example.com/parked'));
      });

      it('does NOT revert when changeInfo.url is a normal URL (no false positive)', () => {
        const tabId = 47;
        makeParkedTabInfo(tabId, 'https://example.com/parked');

        const newUrlTab: chrome.tabs.Tab = {
          id: tabId, windowId: 1, index: 0, url: 'https://other.com',
          title: 'Other', active: true, pinned: false, discarded: false,
          autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
          highlighted: false, incognito: false, selected: true
        };

        onUpdatedListener()(tabId, { url: 'https://other.com' }, newUrlTab);

        // chrome.tabs.update may be called by other code paths (e.g. captureTab),
        // but never with a park.html URL for this case.
        const calls = (chrome.tabs.update as jest.Mock).mock.calls;
        const parkUrlCall = calls.find(([id, obj]: [number, { url?: string }]) =>
          obj?.url?.startsWith((global as any).parkUrl));
        expect(parkUrlCall).toBeUndefined();
      });
    });

    describe('onUpdated — deliberate user navigation is not hijacked (code review fix #3/#4)', () => {
      const onUpdatedListener = () => (chrome.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];

      const makeParkedTabInfo = (tabId: number, parkedUrl: string): any => {
        const info = new TabInfo({ id: tabId, url: parkedUrl } as chrome.tabs.Tab);
        info.parked = true;
        info.parkedUrl = parkedUrl;
        tabManager.tabInfos[tabId] = info;
        return info;
      };

      const makeTab = (tabId: number, overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({
        id: tabId, windowId: 1, index: 0, url: 'about:blank', title: '',
        active: false, pinned: false, discarded: false, autoDiscardable: true,
        audible: false, groupId: 1, status: 'loading', highlighted: false,
        incognito: false, selected: true, ...overrides,
      } as chrome.tabs.Tab);

      afterEach(() => {
        (chrome.tabs.update as jest.Mock).mockClear();
      });

      it('does NOT revert when the user navigates a non-discarded parked tab to about:blank — parked state is cleared instead', () => {
        const tabId = 51;
        const info = makeParkedTabInfo(tabId, 'https://example.com/parked');

        // changeInfo.url IS set → this is a live URL transition (user typed
        // about:blank or a redirect), not Chrome's pre-SW-start replacement.
        onUpdatedListener()(tabId, { url: 'about:blank' }, makeTab(tabId, { discarded: false }));

        const calls = (chrome.tabs.update as jest.Mock).mock.calls;
        const parkUrlCall = calls.find(([, obj]: [number, { url?: string }]) =>
          obj?.url?.startsWith((global as any).parkUrl));
        expect(parkUrlCall).toBeUndefined();
        // The normal clearing logic owns the state transition from here.
        expect(info.parked).toBe(false);
        expect(info.parkedUrl).toBe(null);
      });

      it('does NOT revert when the user navigates a non-discarded parked tab to chrome://newtab/', () => {
        const tabId = 54;
        makeParkedTabInfo(tabId, 'https://example.com/parked');

        onUpdatedListener()(tabId, { url: 'chrome://newtab/' },
          makeTab(tabId, { url: 'chrome://newtab/', discarded: false }));

        const calls = (chrome.tabs.update as jest.Mock).mock.calls;
        const parkUrlCall = calls.find(([, obj]: [number, { url?: string }]) =>
          obj?.url?.startsWith((global as any).parkUrl));
        expect(parkUrlCall).toBeUndefined();
      });

      it('does not throw when tab.url is null/undefined (grouped parked tab, no URL-change event)', () => {
        const tabId = 53;
        makeParkedTabInfo(tabId, 'https://example.com/parked');

        // Tab.url is optional in the chrome API; the listener must survive it.
        expect(() =>
          onUpdatedListener()(tabId, { status: 'loading' }, makeTab(tabId, { url: undefined }))
        ).not.toThrow();

        const calls = (chrome.tabs.update as jest.Mock).mock.calls;
        const parkUrlCall = calls.find(([, obj]: [number, { url?: string }]) =>
          obj?.url?.startsWith((global as any).parkUrl));
        expect(parkUrlCall).toBeUndefined();
      });
    });

    describe('recoverBlankParkedTabsOnStartup — live tab matching (code review fixes #1/#2)', () => {
      const runRecovery = () => (tabManager as any).recoverBlankParkedTabsOnStartup();

      /** Seed persisted tabInfos for one window: `winId` with `tabCount` entries (index 0..tabCount-1). */
      const seedWindow = (winId: number, tabCount: number,
                          parked: Array<{ idx: number; url: string; closed?: boolean }>) => {
        for (let i = 0; i < tabCount; i++) {
          const id = winId * 1000 + i;
          const info = new TabInfo({
            id, windowId: winId, index: i, url: `https://site.com/${i}`,
          } as unknown as chrome.tabs.Tab);
          tabManager.tabInfos[id] = info;
        }
        for (const p of parked) {
          const info = tabManager.tabInfos[winId * 1000 + p.idx];
          info.parked = true;
          info.parkedUrl = p.url;
          if (p.closed) info.closed = { at: 1, tsSessionId: 1 };
        }
      };

      /** Build live tabs for one window: `windowId` with `count` tabs (index 0..count-1). */
      const liveWindowTabs = (windowId: number, count: number,
                              overrides: { [index: number]: Partial<chrome.tabs.Tab> } = {}): chrome.tabs.Tab[] => {
        const tabs: chrome.tabs.Tab[] = [];
        for (let i = 0; i < count; i++) {
          tabs.push({
            id: windowId * 10000 + i, windowId, index: i, url: `https://live.com/${i}`,
            title: 'Live', active: i === 0, pinned: false, discarded: false,
            autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
            highlighted: false, incognito: false, selected: false,
            ...overrides[i],
          } as chrome.tabs.Tab);
        }
        return tabs;
      };

      const parkUrlCalls = () =>
        (chrome.tabs.update as jest.Mock).mock.calls
          .filter(([, obj]: [number, { url?: string }]) => obj?.url?.startsWith((global as any).parkUrl));

      afterEach(() => {
        (chrome.tabs.update as jest.Mock).mockClear();
        (chrome.tabs.query as jest.Mock).mockClear();
      });

      it('matches in-session by exact windowId + index (same browser session, SW cold start)', async () => {
        seedWindow(50, 3, [{ idx: 1, url: 'https://example.com/target' }]);
        (chrome.tabs.query as jest.Mock).mockResolvedValue(
          liveWindowTabs(50, 3, { 1: { url: 'about:blank', groupId: 5 } }));

        await runRecovery();

        const calls = parkUrlCalls();
        expect(calls).toHaveLength(1);
        const [calledTabId, updateObj] = calls[0];
        expect(calledTabId).toBe(50 * 10000 + 1);
        expect(updateObj.url).toContain(`url=${encodeURIComponent('https://example.com/target')}`);
      });

      it('matches across a browser restart: windowId/tabId changed, but tab-count fingerprint + index identify the window', async () => {
        // Persisted state from the PREVIOUS session: window 50, 6 tabs, tab at
        // index 3 parked. Its newRefId chain points at previous-session IDs.
        seedWindow(50, 6, [{ idx: 3, url: 'https://example.com/target' }]);

        // Live state after restart: NEW window 77 with the same 6 tabs; the
        // parked tab at index 3 is now a blank grouped tab with a NEW id.
        (chrome.tabs.query as jest.Mock).mockResolvedValue(
          liveWindowTabs(77, 6, { 3: { url: 'about:blank', groupId: 5 } }));

        await runRecovery();

        const calls = parkUrlCalls();
        expect(calls).toHaveLength(1);
        const [calledTabId, updateObj] = calls[0];
        expect(calledTabId).toBe(77 * 10000 + 3);
        expect(updateObj.url).toContain(`tabId=${77 * 10000 + 3}`);
        expect(updateObj.url).toContain(`url=${encodeURIComponent('https://example.com/target')}`);
      });

      it('skips closed parked entries even when the position matches (no hijacking of unrelated tabs)', async () => {
        seedWindow(50, 3, [{ idx: 1, url: 'https://example.com/dead', closed: true }]);
        (chrome.tabs.query as jest.Mock).mockResolvedValue(
          liveWindowTabs(50, 3, { 1: { url: 'about:blank', groupId: 5 } }));

        await runRecovery();

        expect(parkUrlCalls()).toHaveLength(0);
      });

      it('does not match when two live windows share the same tab count (ambiguous window pairing)', async () => {
        seedWindow(50, 6, [{ idx: 3, url: 'https://example.com/target' }]);
        (chrome.tabs.query as jest.Mock).mockResolvedValue([
          ...liveWindowTabs(77, 6, { 3: { url: 'about:blank', groupId: 5 } }),
          ...liveWindowTabs(88, 6, { 3: { url: 'about:blank', groupId: 6 } }),
        ]);

        await runRecovery();

        // Recovering the WRONG tab is worse than recovering nothing.
        expect(parkUrlCalls()).toHaveLength(0);
      });

      it('does not match when no live window has the persisted tab count', async () => {
        seedWindow(50, 6, [{ idx: 3, url: 'https://example.com/target' }]);
        (chrome.tabs.query as jest.Mock).mockResolvedValue(
          liveWindowTabs(77, 7, { 3: { url: 'about:blank', groupId: 5 } }));

        await runRecovery();

        expect(parkUrlCalls()).toHaveLength(0);
      });

      it('does not touch blank tabs that are not grouped', async () => {
        seedWindow(50, 3, [{ idx: 1, url: 'https://example.com/target' }]);
        (chrome.tabs.query as jest.Mock).mockResolvedValue(
          liveWindowTabs(50, 3, { 1: { url: 'about:blank', groupId: -1 } }));

        await runRecovery();

        expect(parkUrlCalls()).toHaveLength(0);
      });
    });

    describe('onTabReplaceDetected — closed intermediate keeps its own identity (code review fix #7)', () => {
      const originTab: chrome.tabs.Tab = {
        id: 1, windowId: 1, index: 0, url: 'https://example.com',
        title: 'Example', active: true, pinned: false, discarded: false,
        autoDiscardable: true, audible: false, groupId: -1, status: 'complete',
        highlighted: false, incognito: false, selected: true
      };

      it('closed intermediate entry keeps id=removedTabId (not the live id) while preserving the chain', () => {
        tabManager.createNewTabInfo(originTab);
        tabManager.tabInfos[1].parked = true;
        tabManager.tabInfos[1].parkedUrl = 'https://example.com';

        const parkTabUrl = `${(global as any).parkUrl}?tabId=1&url=${encodeURIComponent('https://example.com')}`;

        // First replace: live id 2, tabId param (1) === removedTabId → origin branch.
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...originTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });
        tabManager.onTabReplaceDetected(2, 1);

        // Second replace: live id 3, tab still shows tabId=1 → intermediate
        // branch for removedTabId=2 (1 !== 2).
        (chrome.tabs.get as jest.Mock).mockImplementationOnce((tabId: number, cb: (t: chrome.tabs.Tab) => void) => {
          cb({ ...originTab, id: tabId, url: parkTabUrl } as chrome.tabs.Tab);
        });
        tabManager.onTabReplaceDetected(3, 2);

        const intermediate = tabManager.getTabInfoById(2);
        expect(typeof intermediate.toObject).toBe('function');
        // Own identity, not the live tab's id.
        expect(intermediate.id).toBe(2);
        // Chain links preserved: origin 1 → intermediate 2 → live 3.
        expect(intermediate.oldRefId).toBe(1);
        expect(intermediate.newRefId).toBe(3);
        expect(intermediate.closed).toBeDefined();
        // The live entry is intact.
        expect(tabManager.getTabInfoById(3).id).toBe(3);
      });
    });
  });
});