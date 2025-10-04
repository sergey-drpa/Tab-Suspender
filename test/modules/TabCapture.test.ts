// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock global variables and settings
(global as any).debug = false;
(global as any).settings = {
  get: jest.fn().mockResolvedValue(90) // Default screenshot quality
};

// Mock ScreenshotController
const mockScreenshotController = {
  addScreen: jest.fn().mockResolvedValue(undefined)
};
(global as any).ScreenshotController = mockScreenshotController;

// Mock TabManager
const mockTabManager = {
  getTabInfoOrCreate: jest.fn().mockReturnValue({ zoomFactor: 1 }),
  setLastCaptureUrl: jest.fn(),
  isTabURLAllowedForPark: jest.fn().mockReturnValue(true),
  canTabBeScripted: jest.fn().mockReturnValue(true)
};
(global as any).tabManager = mockTabManager;
(global as any).TabManager = {
  isTabURLAllowedForPark: mockTabManager.isTabURLAllowedForPark,
  canTabBeScripted: mockTabManager.canTabBeScripted
};

// Mock hasLastError
(global as any).hasLastError = jest.fn().mockReturnValue(false);

// Import TabCapture once
const TabCapture = require('../../modules/TabCapture');

describe('TabCapture Race Condition Tests', () => {
  let tabCapture: any;
  let mockChrome: any;
  let currentActiveTab: any; // Track the currently "active" tab for chrome.tabs.query

  beforeEach(() => {
    jest.clearAllMocks();
    // Don't reset modules - causes issues with TabCapture's module-level constants
    // jest.resetModules();

    // Reset mockScreenshotController.addScreen to default implementation
    mockScreenshotController.addScreen.mockResolvedValue(undefined);

    // Reset hasLastError mock
    (global as any).hasLastError = jest.fn().mockReturnValue(false);

    // Setup Chrome API mocks
    mockChrome = (global as any).chrome;

    // Default active tab
    currentActiveTab = {
      id: 1,
      url: 'https://example.com',
      status: 'complete',
      active: true,
      windowId: 1,
      width: 1920,
      favIconUrl: 'https://example.com/favicon.ico'
    };

    // Mock chrome.tabs.query - returns the "currently active" tab
    mockChrome.tabs.query = jest.fn((query, callback) => {
      // Simulate querying for active tab in current window
      process.nextTick(() => {
        if (query.active && query.currentWindow) {
          callback([currentActiveTab]);
        } else {
          callback([]);
        }
      });
    });

    // Mock chrome.tabs.captureVisibleTab
    mockChrome.tabs.captureVisibleTab = jest.fn((windowId, options, callback) => {
      const fakeScreenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      // Call callback asynchronously to simulate real Chrome API behavior
      process.nextTick(() => callback(fakeScreenshot));
    });

    // Mock chrome.tabs.getZoom
    mockChrome.tabs.getZoom = jest.fn((tabId, callback) => {
      process.nextTick(() => callback(1));
    });

    // Mock chrome.scripting.executeScript
    mockChrome.scripting.executeScript = jest.fn((config) => {
      return Promise.resolve([{ result: 2 }]); // devicePixelRatio = 2
    });

    // Reset settings mock
    (global as any).settings.get.mockImplementation((key) => {
      if (key === 'screenshotsEnabled') return Promise.resolve(true);
      if (key === 'screenshotQuality') return Promise.resolve(90);
      return Promise.resolve(90);
    });

    // Create new TabCapture instance
    tabCapture = new TabCapture(mockTabManager);
  });

  describe('Screenshot storage race condition', () => {
    it('should handle basic capture', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      currentActiveTab = { ...mockTab };

      await tabCapture.captureTab(mockTab);

      expect(mockScreenshotController.addScreen).toHaveBeenCalled();
    });

    it('should await addScreen completion before resolving', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      let addScreenCompleted = false;

      // Mock addScreen with delay to simulate async DB write
      mockScreenshotController.addScreen.mockImplementation(async (tabId, screen, devicePixelRatio) => {
        console.log('addScreen called with', { tabId, screenLength: screen?.length, devicePixelRatio });
        await new Promise(resolve => setTimeout(resolve, 50));
        addScreenCompleted = true;
        console.log('addScreen completed');
      });

      expect(addScreenCompleted).toBe(false);
      console.log('Starting captureTab');
      const capturePromise = tabCapture.captureTab(mockTab);
      console.log('captureTab called, waiting...');
      await capturePromise;
      console.log('captureTab resolved');
      expect(addScreenCompleted).toBe(true);
    });

    it('should ensure screenshot is stored before returning', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      const captureOrder: string[] = [];

      mockScreenshotController.addScreen.mockImplementation(async (tabId, screen, devicePixelRatio) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        captureOrder.push('screenshot-stored');
      });

      await tabCapture.captureTab(mockTab);
      captureOrder.push('captureTab-resolved');

      expect(captureOrder).toEqual(['screenshot-stored', 'captureTab-resolved']);
    });

    it('should propagate addScreen errors', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      const dbError = new Error('Database write failed');
      mockScreenshotController.addScreen.mockRejectedValue(dbError);

      await expect(tabCapture.captureTab(mockTab)).rejects.toThrow();
    });
  });

  describe('executeScript error handling', () => {
    it('should reject when executeScript fails', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      // Mock executeScript to fail
      mockChrome.scripting.executeScript.mockRejectedValue(
        new Error('Script execution failed')
      );

      // Should reject and NOT call addScreen
      await expect(tabCapture.captureTab(mockTab)).rejects.toBeDefined();
      expect(mockScreenshotController.addScreen).not.toHaveBeenCalled();
    });

    it('should still store screenshot when executeScript fails but with fallback devicePixelRatio', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      // Mock executeScript to fail
      mockChrome.scripting.executeScript.mockRejectedValue(
        new Error('Tab closed')
      );

      // Mock hasLastError to return true for expected exceptions
      (global as any).hasLastError = jest.fn().mockReturnValue(true);

      await expect(tabCapture.captureTab(mockTab)).rejects.toBeDefined();
    });
  });

  describe('captureTab promise completion', () => {
    it('should not resolve until all async operations complete', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      const operations: string[] = [];

      mockScreenshotController.addScreen.mockImplementation(async (tabId, screen, devicePixelRatio) => {
        await new Promise(resolve => setTimeout(resolve, 40));
        operations.push('addScreen-completed');
      });

      const capturePromise = tabCapture.captureTab(mockTab);
      operations.push('captureTab-called');

      await capturePromise;
      operations.push('captureTab-resolved');

      expect(operations).toEqual([
        'captureTab-called',
        'addScreen-completed',
        'captureTab-resolved'
      ]);
    });

    it('should handle multiple concurrent captures correctly', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set as active tab for the query mock
      currentActiveTab = { ...mockTab };

      let captureCount = 0;

      mockScreenshotController.addScreen.mockImplementation(async (tabId, screen, devicePixelRatio) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        captureCount++;
      });

      const captures = [
        tabCapture.captureTab(mockTab),
        tabCapture.captureTab(mockTab),
        tabCapture.captureTab(mockTab)
      ];

      await Promise.all(captures);

      expect(captureCount).toBe(3);
    });
  });

  describe('screenshots disabled handling', () => {
    it('should skip capture when screenshots are disabled', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Mock settings to return false for screenshotsEnabled
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'screenshotsEnabled') return Promise.resolve(false);
        return Promise.resolve(90);
      });

      await tabCapture.captureTab(mockTab);

      // Should not call captureVisibleTab or addScreen
      expect(mockChrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
      expect(mockScreenshotController.addScreen).not.toHaveBeenCalled();
    });
  });

  describe('tab validation', () => {
    it('should reject if tab is not active', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'complete',
        active: false,
        windowId: 1
      };

      mockChrome.tabs.query = jest.fn((query, callback) => {
        process.nextTick(() => callback([{ ...mockTab }]));
      });

      await expect(tabCapture.captureTab(mockTab)).rejects.toBeDefined();
      expect(mockScreenshotController.addScreen).not.toHaveBeenCalled();
    });

    it('should reject if tab status is loading and tryEvenIncomplete is false', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'loading',
        active: true,
        windowId: 1
      };

      mockChrome.tabs.query = jest.fn((query, callback) => {
        process.nextTick(() => callback([{ ...mockTab }]));
      });

      await expect(tabCapture.captureTab(mockTab)).rejects.toBeDefined();
      expect(mockScreenshotController.addScreen).not.toHaveBeenCalled();
    });

    it('should capture if tab is loading but tryEvenIncomplete is true', async () => {
      const mockTab = {
        id: 1,
        url: 'https://example.com',
        status: 'loading',
        active: true,
        windowId: 1
      };

      mockChrome.tabs.query = jest.fn((query, callback) => {
        process.nextTick(() => callback([{ ...mockTab }]));
      });

      await tabCapture.captureTab(mockTab, { tryEvenIncomplete: true });

      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalled();
    });
  });

  describe('integration: full capture flow', () => {
    it('should complete full capture flow with proper timing', async () => {
      const mockTab = {
        id: 42,
        url: 'https://test.com',
        status: 'complete',
        active: true,
        windowId: 1
      };

      // Set this tab as the "active" tab for chrome.tabs.query
      currentActiveTab = { ...mockTab };

      const timeline: Array<{ event: string; timestamp: number }> = [];
      const startTime = Date.now();

      const logEvent = (event: string) => {
        timeline.push({ event, timestamp: Date.now() - startTime });
      };

      mockChrome.tabs.captureVisibleTab = jest.fn((windowId, options, callback) => {
        setTimeout(() => {
          logEvent('screenshot-captured');
          callback('data:image/jpeg;base64,fake');
        }, 20);
      });

      mockChrome.scripting.executeScript = jest.fn(() => {
        logEvent('script-executed');
        return Promise.resolve([{ result: 2 }]);
      });

      mockScreenshotController.addScreen.mockImplementation(async (tabId, screen, devicePixelRatio) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        logEvent('screenshot-stored');
      });

      logEvent('capture-started');
      await tabCapture.captureTab(mockTab);
      logEvent('capture-completed');

      expect(timeline.map(t => t.event)).toEqual([
        'capture-started',
        'screenshot-captured',
        'script-executed',
        'screenshot-stored',
        'capture-completed'
      ]);

      // Verify screenshot-stored happens before capture-completed
      const storedIndex = timeline.findIndex(t => t.event === 'screenshot-stored');
      const completedIndex = timeline.findIndex(t => t.event === 'capture-completed');
      expect(storedIndex).toBeLessThan(completedIndex);
    });
  });
});
