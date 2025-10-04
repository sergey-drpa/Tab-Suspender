// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock IndexedDB for testing
require('fake-indexeddb/auto');

// Mock global variables
(global as any).TSSessionId = 123456;
(global as any).debugScreenCache = false;
(global as any).SCREENS_DB_NAME = 'screens';
(global as any).parkUrl = 'chrome-extension://test/park.html';
(global as any).getScreenCache = null;

// Mock database
const mockDatabase = {
  isInitialized: jest.fn().mockReturnValue(true),
  getInitializedPromise: jest.fn().mockResolvedValue(undefined),
  queryIndex: jest.fn(),
  queryIndexCount: jest.fn(),
  putV2: jest.fn()
};

(global as any).database = mockDatabase;

// Mock tabManager
(global as any).tabManager = {
  findReplacedTabId: jest.fn((id) => id)
};

// Mock settings
(global as any).settings = {
  get: jest.fn().mockResolvedValue(true) // Default: screenshots enabled
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ScreenshotController Tests', () => {
  let ScreenshotController: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Clear cache
    (global as any).getScreenCache = null;

    // Reset settings mock to default (screenshots enabled)
    (global as any).settings.get.mockResolvedValue(true);

    // Reset database mock to initialized state
    mockDatabase.isInitialized.mockReturnValue(true);

    // Re-import ScreenshotController
    const ScreenshotControllerModule = require('../../modules/ScreenshotController');
    ScreenshotController = ScreenshotControllerModule.ScreenshotController;
  });

  describe('addScreen', () => {
    it('should add screenshot to database and await completion', async () => {
      const tabId = 1;
      const screenData = 'data:image/jpeg;base64,dGVzdA==';
      const pixelRatio = 2;
      const testDate = new Date('2024-01-01');

      mockDatabase.putV2.mockResolvedValue(undefined);

      await ScreenshotController.addScreen(tabId, screenData, pixelRatio, testDate);

      expect(mockDatabase.putV2).toHaveBeenCalledWith([
        {
          IDB: {
            table: 'screens',
            data: {
              id: tabId,
              sessionId: 123456,
              added_on: testDate,
              screen: screenData,
              pixRat: pixelRatio
            }
          }
        }
      ]);
    });

    it('should handle string tabId', async () => {
      const tabId = '123';
      const screenData = 'data:image/png;base64,aGVsbG8=';
      const pixelRatio = 1;

      mockDatabase.putV2.mockResolvedValue(undefined);

      await ScreenshotController.addScreen(tabId, screenData, pixelRatio);

      expect(mockDatabase.putV2).toHaveBeenCalledWith([
        {
          IDB: {
            table: 'screens',
            data: {
              id: 123, // Should be converted to number
              sessionId: 123456,
              added_on: expect.any(Date),
              screen: screenData,
              pixRat: pixelRatio
            }
          }
        }
      ]);
    });

    it('should not add if screen is null', async () => {
      await ScreenshotController.addScreen(1, null, 2);
      expect(mockDatabase.putV2).not.toHaveBeenCalled();
    });

    it('should warn if devicePixelRatio is null', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const screenData = 'data:image/jpeg;base64,dGVzdA==';

      mockDatabase.putV2.mockResolvedValue(undefined);

      await ScreenshotController.addScreen(1, screenData, null);

      expect(consoleSpy).toHaveBeenCalledWith('addScreen(): devicePixelRatio is null!!!');
      consoleSpy.mockRestore();
    });

    it('should propagate database errors', async () => {
      const tabId = 1;
      const screenData = 'data:image/jpeg;base64,dGVzdA==';
      const pixelRatio = 2;
      const dbError = new Error('Database write failed');

      mockDatabase.putV2.mockRejectedValue(dbError);

      await expect(
        ScreenshotController.addScreen(tabId, screenData, pixelRatio)
      ).rejects.toThrow('Database write failed');
    });

    it('should wait for putV2 to complete before resolving', async () => {
      const tabId = 1;
      const screenData = 'data:image/jpeg;base64,dGVzdA==';
      const pixelRatio = 2;
      let putCompleted = false;

      mockDatabase.putV2.mockImplementation(async () => {
        // Simulate async operation
        await Promise.resolve();
        putCompleted = true;
      });

      expect(putCompleted).toBe(false);
      await ScreenshotController.addScreen(tabId, screenData, pixelRatio);
      expect(putCompleted).toBe(true);
    });
  });

  describe('getScreen', () => {
    it('should retrieve screen from database', async () => {
      const tabId = 1;
      const sessionId = 123456;
      const expectedScreen = 'data:image/jpeg;base64,dGVzdA==';
      const expectedPixelRatio = 2;

      // Mock database response
      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        expect(config.params).toEqual([tabId, sessionId]);
        callback({
          screen: expectedScreen,
          pixRat: expectedPixelRatio
        });
      });

      let resultScreen: string;
      let resultPixelRatio: number;

      await ScreenshotController.getScreen(tabId, sessionId, (screen, pixelRatio) => {
        resultScreen = screen;
        resultPixelRatio = pixelRatio;
      });

      expect(resultScreen).toBe(expectedScreen);
      expect(resultPixelRatio).toBe(expectedPixelRatio);
    });

    it('should use default sessionId if not provided', () => {
      const tabId = 1;

      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        expect(config.params).toEqual([tabId, 123456]); // Should use TSSessionId
        callback(null);
      });

      ScreenshotController.getScreen(tabId, null, () => {});
    });

    it('should return null if screen not found', async () => {
      const tabId = 1;
      const sessionId = 123456;

      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        callback(null); // No screen found
      });

      let result: any = undefined;
      await ScreenshotController.getScreen(tabId, sessionId, (screen) => {
        result = screen;
      });

      expect(result).toBeNull();
    });

    it('should wait for database initialization if not ready', async () => {
      const tabId = 1;
      const sessionId = 123456;

      // Mock database as not initialized initially
      mockDatabase.isInitialized.mockReturnValueOnce(false);

      // Mock the promise to resolve immediately
      mockDatabase.getInitializedPromise.mockResolvedValue(undefined);

      let callbackCalled = false;
      await ScreenshotController.getScreen(tabId, sessionId, () => {
        callbackCalled = true;
      });

      // Should have tried to wait for initialization
      expect(mockDatabase.getInitializedPromise).toHaveBeenCalled();
    });

    it('should handle max retries for database initialization', async () => {
      const tabId = 1;
      const sessionId = 123456;

      // Mock database as not initialized
      mockDatabase.isInitialized.mockReturnValue(false);

      // Mock promise that never resolves or rejects (simulating permanent failure)
      const neverResolvingPromise = new Promise(() => {}); // Never resolves
      mockDatabase.getInitializedPromise.mockReturnValue(neverResolvingPromise);

      let callbackResult: any = undefined;
      let callbackCallCount = 0;

      await ScreenshotController.getScreen(tabId, sessionId, (result) => {
        callbackResult = result;
        callbackCallCount++;
      });

      // Should have tried to wait for initialization
      expect(mockDatabase.getInitializedPromise).toHaveBeenCalled();

      // Simulate retries by calling with increasing retry count
      // After MAX_RETRIES (3), should call callback with null
      await ScreenshotController.getScreen(tabId, sessionId, (result) => {
        callbackResult = result;
        callbackCallCount++;
      }, 3); // MAX_RETRIES

      expect(callbackResult).toBeNull();
      expect(callbackCallCount).toBe(1);
    });

    it('should retry with incremental count and timeout mechanism', (done) => {
      const tabId = 1;
      const sessionId = 123456;
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock database as not initialized
      mockDatabase.isInitialized.mockReturnValue(false);

      // Mock rejecting promise to trigger retry
      mockDatabase.getInitializedPromise.mockRejectedValue(new Error('DB init failed'));

      let retryCount = 0;
      const originalGetScreen = ScreenshotController.getScreen;

      // Spy on getScreen to track retry calls
      jest.spyOn(ScreenshotController, 'getScreen').mockImplementation((id: any, sessionId: any, callback: (result: any) => void, currentRetryCount: number = 0) => {
        if ((currentRetryCount as number) < 2) {
          retryCount = currentRetryCount as number;
          // Call original method to test actual retry logic
          return originalGetScreen.call(ScreenshotController, id, sessionId, callback, currentRetryCount);
        } else {
          // On final retry, call callback with null
          (callback as Function)(null);
          done();
        }
      });

      ScreenshotController.getScreen(tabId, sessionId, (result: any) => {
        expect(result).toBeNull();
      });

      // Cleanup
      setTimeout(() => {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        (ScreenshotController.getScreen as jest.Mock).mockRestore();
      }, 100);
    });

    it('should use cache if available', async () => {
      const tabId = 1;
      const sessionId = 123456;
      const cachedScreen = 'cached-screen-data';
      const cachedPixelRatio = 1.5;

      // Ensure database is initialized for this test
      mockDatabase.isInitialized.mockReturnValue(true);

      // Clear any existing cache
      (global as any).getScreenCache = null;

      // Create an immediately resolved promise
      const cachePromise = Promise.resolve();

      (global as any).getScreenCache = {
        sessionId: sessionId,
        tabId: tabId,
        getScreenPromise: cachePromise,
        screen: cachedScreen,
        pixRat: cachedPixelRatio
      };

      // Use Promise to handle callback
      const result = await new Promise<{screen: string, pixelRatio: number}>((resolve) => {
        ScreenshotController.getScreen(tabId, sessionId, (screen, pixelRatio) => {
          resolve({ screen, pixelRatio });
        });
      });

      expect(result.screen).toBe(cachedScreen);
      expect(result.pixelRatio).toBe(cachedPixelRatio);
      expect((global as any).getScreenCache).toBeNull(); // Should clear cache
      expect(mockDatabase.queryIndex).not.toHaveBeenCalled(); // Should not query DB
    });

    it('should clear cache if tabId or sessionId mismatch', async () => {
      const tabId = 1;
      const sessionId = 123456;

      // Ensure database is initialized for this test
      mockDatabase.isInitialized.mockReturnValue(true);

      // Clear any existing cache
      (global as any).getScreenCache = null;

      // Set up cache with different values
      (global as any).getScreenCache = {
        sessionId: 999999, // Different session
        tabId: tabId,
        getScreenPromise: Promise.resolve(),
        screen: 'cached-data',
        pixRat: 1
      };

      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        callback({ screen: 'db-screen', pixRat: 1 });
      });

      // Use Promise to handle callback
      const result = await new Promise<{screen: string, pixelRatio: number}>((resolve) => {
        ScreenshotController.getScreen(tabId, sessionId, (screen, pixelRatio) => {
          resolve({ screen, pixelRatio });
        });
      });

      expect((global as any).getScreenCache).toBeNull(); // Should clear mismatched cache
      expect(mockDatabase.queryIndex).toHaveBeenCalled(); // Should query DB instead
      expect(result.screen).toBe('db-screen'); // Should get data from DB
    });

    it('should handle cache promise errors and fall back to database', async () => {
      const tabId = 1;
      const sessionId = 123456;
      const cachedScreen = 'cached-screen-data';
      const cachedPixelRatio = 1.5;
      const dbScreen = 'db-screen';
      const dbPixelRatio = 2;

      // Ensure database is initialized for this test
      mockDatabase.isInitialized.mockReturnValue(true);

      // Set up cache with a failing promise
      const cachePromise = Promise.reject(new Error('Cache operation failed'));

      (global as any).getScreenCache = {
        sessionId: sessionId,
        tabId: tabId,
        getScreenPromise: cachePromise,
        screen: cachedScreen,
        pixRat: cachedPixelRatio
      };

      // Mock database to return fallback data
      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        callback({
          screen: dbScreen,
          pixRat: dbPixelRatio
        });
      });

      // Use Promise to handle the callback and properly catch the rejection
      const result = await new Promise<{screen: string, pixelRatio: number}>((resolve) => {
        ScreenshotController.getScreen(tabId, sessionId, (screen, pixelRatio) => {
          resolve({ screen, pixelRatio });
        });
      });

      // Should fall back to database when cache promise fails
      expect(result.screen).toBe(dbScreen);
      expect(result.pixelRatio).toBe(dbPixelRatio);
      expect((global as any).getScreenCache).toBeNull(); // Should clear cache after error
      expect(mockDatabase.queryIndex).toHaveBeenCalled(); // Should query database as fallback
    });

    it('should skip cache and query database when cache is still initializing (deadlock prevention)', async () => {
      const tabId = 1;
      const sessionId = 123456;
      const dbScreen = 'db-screen-data';
      const dbPixelRatio = 2;

      // Ensure database is initialized for this test
      mockDatabase.isInitialized.mockReturnValue(true);

      // Set up cache that's still initializing (screen is null)
      // This simulates the scenario where TabManager creates the cache and calls getScreen
      // from within the promise callback, which would cause a deadlock without the fix
      let promiseResolve: () => void;
      const cachePromise = new Promise<void>((resolve) => {
        promiseResolve = resolve;
      });

      (global as any).getScreenCache = {
        sessionId: sessionId,
        tabId: tabId,
        getScreenPromise: cachePromise,
        screen: null, // Still initializing - this is the key to triggering deadlock prevention
        pixRat: null
      };

      // Mock database to return data
      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        expect(config.params).toEqual([tabId, sessionId]);
        callback({
          screen: dbScreen,
          pixRat: dbPixelRatio
        });
      });

      // Call getScreen - should skip cache and query database
      const result = await new Promise<{screen: string, pixelRatio: number}>((resolve) => {
        ScreenshotController.getScreen(tabId, sessionId, (screen, pixelRatio) => {
          resolve({ screen, pixelRatio });
        });
      });

      // Verify it queried the database instead of waiting for cache
      expect(mockDatabase.queryIndex).toHaveBeenCalled();
      expect(result.screen).toBe(dbScreen);
      expect(result.pixelRatio).toBe(dbPixelRatio);

      // Cache should still exist (not cleared) since we only skipped it
      expect((global as any).getScreenCache).not.toBeNull();
    });

    it('should avoid deadlock when cache is being initialized by the same call', async () => {
      const tabId = 1;
      const sessionId = 123456;
      const dbScreen = 'data:image/jpeg;base64,dGVzdA==';
      const dbPixelRatio = 1.5;

      // Ensure database is initialized
      mockDatabase.isInitialized.mockReturnValue(true);

      // This test simulates the exact deadlock scenario:
      // 1. TabManager creates cache with null screen
      // 2. TabManager's promise callback calls ScreenshotController.getScreen
      // 3. That call sees the cache it's initializing and would try to await it (deadlock!)
      // 4. With the fix, it should skip the cache since screen is null

      // Simulate TabManager's behavior
      let getScreenCallbackExecuted = false;

      // Create cache like TabManager does
      (global as any).getScreenCache = {
        sessionId: sessionId,
        tabId: tabId,
        getScreenPromise: new Promise<void>((resolve) => {
          // Inside the promise, TabManager would call getScreen
          // Mock database to return data when queried
          mockDatabase.queryIndex.mockImplementation((config, callback) => {
            callback({
              screen: dbScreen,
              pixRat: dbPixelRatio
            });
          });

          // This is the call that would deadlock without the fix
          ScreenshotController.getScreen(tabId, sessionId, (screen, pixRat) => {
            // Update cache with results (like TabManager does)
            if ((global as any).getScreenCache != null) {
              (global as any).getScreenCache.screen = screen;
              (global as any).getScreenCache.pixRat = pixRat;
            }
            getScreenCallbackExecuted = true;
            resolve();
          });
        }),
        screen: null, // Still initializing
        pixRat: null
      };

      // Wait for the promise to resolve
      await (global as any).getScreenCache.getScreenPromise;

      // Verify the callback was executed (no deadlock)
      expect(getScreenCallbackExecuted).toBe(true);
      expect(mockDatabase.queryIndex).toHaveBeenCalled();

      // Cache should now have the data
      expect((global as any).getScreenCache.screen).toBe(dbScreen);
      expect((global as any).getScreenCache.pixRat).toBe(dbPixelRatio);
    });

    it('should return null when screenshots are disabled', async () => {
      const tabId = 1;
      const sessionId = 123456;

      // Mock settings to return false for screenshotsEnabled
      (global as any).settings.get.mockImplementation((key: string) => {
        if (key === 'screenshotsEnabled') return Promise.resolve(false);
        return Promise.resolve(true);
      });

      let resultScreen: any = undefined;
      let callbackCalled = false;

      await ScreenshotController.getScreen(tabId, sessionId, (screen) => {
        resultScreen = screen;
        callbackCalled = true;
      });

      expect(callbackCalled).toBe(true);
      expect(resultScreen).toBeNull();
      expect(mockDatabase.queryIndex).not.toHaveBeenCalled(); // Should not query database
    });
  });

  describe('isScreenExist', () => {
    it('should check if screen exists in database', () => {
      const tabId = 1;
      const sessionId = 123456;
      const expectedCount = 1;

      mockDatabase.queryIndexCount.mockImplementation((config, callback) => {
        expect(config.params).toEqual([tabId, sessionId]);
        callback(expectedCount);
      });

      let result: number;
      ScreenshotController.isScreenExist(tabId, sessionId, (count) => {
        result = count;
      });

      expect(result).toBe(expectedCount);
    });

    it('should use default sessionId if not provided', () => {
      const tabId = 1;

      mockDatabase.queryIndexCount.mockImplementation((config, callback) => {
        expect(config.params).toEqual([tabId, 123456]); // Should use TSSessionId
        callback(0);
      });

      ScreenshotController.isScreenExist(tabId, null, () => {});
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete add and retrieve cycle', (done) => {
      const tabId = 42;
      const sessionId = 123456;
      const screenData = 'data:image/jpeg;base64,VGVzdEltYWdl';
      const pixelRatio = 2;

      // Ensure database is initialized for this test
      mockDatabase.isInitialized.mockReturnValue(true);

      // Add screen
      ScreenshotController.addScreen(tabId, screenData, pixelRatio);

      // Verify add was called
      expect(mockDatabase.putV2).toHaveBeenCalledWith([
        {
          IDB: {
            table: 'screens',
            data: {
              id: tabId,
              sessionId: sessionId,
              added_on: expect.any(Date),
              screen: screenData,
              pixRat: pixelRatio
            }
          }
        }
      ]);

      // Mock retrieval
      mockDatabase.queryIndex.mockImplementation((config, callback) => {
        callback({
          screen: screenData,
          pixRat: pixelRatio
        });
      });

      // Retrieve screen
      ScreenshotController.getScreen(tabId, sessionId, (screen, pixRat) => {
        expect(screen).toBe(screenData);
        expect(pixRat).toBe(pixelRatio);
        done();
      });
    });
  });
});