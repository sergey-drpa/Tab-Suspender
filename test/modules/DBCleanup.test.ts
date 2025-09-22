// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock IndexedDB for testing
require('fake-indexeddb/auto');

// Mock global variables
(global as any).TSSessionId = 123456;
(global as any).previousTSSessionId = '123455';
(global as any).SCREENS_DB_NAME = 'screens';
(global as any).FD_DB_NAME = 'fds';
(global as any).ADDED_ON_INDEX_NAME = 'added_on';
(global as any).parkUrl = 'chrome-extension://test/park.html';

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

// Mock database
const mockDatabase = {
  getAll: jest.fn(),
  isInitialized: jest.fn().mockReturnValue(true),
  getInitializedPromise: jest.fn().mockResolvedValue(undefined),
  queryIndexByRange: jest.fn(),
  deleteIndex: jest.fn()
};

(global as any).database = mockDatabase;

// Mock ScreenshotController
const mockScreenshotController = {
  addScreen: jest.fn()
};

(global as any).ScreenshotController = mockScreenshotController;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Define types from DbUtils
type IDBAddedOnIndexType = [number, number, Date | string | null];
type IDBPKKeyArrayType = [number, number];
type IDBFdsValueType = { tabId: number, data: { timestamp: number | Date } };
type IDBFdsKeyArrayType = [number][];

describe('DBCleanup Tests', () => {
  let dbCleanup_filterScreenResults: any;
  let dbCleanup_filterFdsResults: any;
  let cleanupDB: any;
  let TWO_WEEKS_MS: number;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-import DbUtils
    const DbUtilsModule = require('../../modules/DbUtils');
    dbCleanup_filterScreenResults = DbUtilsModule.dbCleanup_filterScreenResults;
    dbCleanup_filterFdsResults = DbUtilsModule.dbCleanup_filterFdsResults;
    cleanupDB = DbUtilsModule.cleanupDB;
    TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14; // 14 Days
  });

  describe('Screen Cleanup Logic', () => {
    it('should identify unused screens for removal (without dates)', () => {
      const usedSessionIds: { [sessionId: number]: boolean } = {
        222: true,
        333: true
      };
      const usedTabIds: { [tabId: number]: number } = {
        // tabId: sessionId
        1: 0,
        2: 222,
        3: 222,
        4: 333
      };

      const screensFromDb: IDBAddedOnIndexType[] = [
        // [tabId, sessionId, date]
        [0, 0, null], // <- Should be deleted/returned (tabId 0 not in usedTabIds)
        [1, 0, null], // <- Should be kept (tabId 1 exists in usedTabIds)
        [5, 111, null], // <- Should be deleted/returned (sessionId 111 not in usedSessionIds)
        [2, 222, null], // <- Should be kept (both tabId and sessionId are used)
        [3, 222, null], // <- Should be kept (both tabId and sessionId are used)
        [4, 333, null]  // <- Should be kept (both tabId and sessionId are used)
      ];

      const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
      const result = filterFunction(screensFromDb);

      expect(result).toEqual([
        [0, 0, null],  // Unused tabId 0
        [5, 111, null] // Unused sessionId 111
      ]);
    });

    it('should identify expired screens for removal', () => {
      const usedSessionIds: { [sessionId: number]: boolean } = {
        222: true,
        333: true
      };
      const usedTabIds: { [tabId: number]: number } = {
        // tabId: sessionId
        1: 0,
        2: 222,
        3: 222
        // Note: tabId 4 is not in usedTabIds
      };

      const today = new Date();
      const dayMs = 86400000;

      const screensFromDb: IDBAddedOnIndexType[] = [
        // [tabId, sessionId, date]
        [0, 0, today], // Recent, but tabId not used -> should be kept (recent)
        [0, 100, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // Expired and sessionId not used -> delete
        [1, 0, new Date(today.getTime() - (5 * dayMs))], // Recent and tabId used -> keep
        [5, 111, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // Expired and sessionId not used -> delete
        [2, 222, new Date(today.getTime() - (7 * dayMs))], // Recent and both used -> keep
        [3, 222, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // Expired but tabId used -> keep
        [4, 333, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // Expired and tabId not used -> delete
        [6, 333, new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs))], // Recent -> keep
        [7, 444, new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs))] // Recent but sessionId not used -> keep (recent)
      ];

      const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
      const result = filterFunction(screensFromDb);

      expect(result).toEqual([
        [0, 100, expect.any(Date)], // Expired and unused sessionId
        [5, 111, expect.any(Date)], // Expired and unused sessionId
        [4, 333, expect.any(Date)]  // Expired and unused tabId
      ]);
    });
  });

  describe('FDS Cleanup Logic', () => {
    it('should identify expired FDS entries for removal', () => {
      const openedTabIds: { [tabId: number]: number } = {
        // tabId: tabId (currently opened tabs)
        1: 1,
        2: 2,
        3: 3
      };

      const today = new Date();
      const dayMs = 86400000;

      const fdsFromDb: IDBFdsValueType[] = [
        { tabId: 0, data: { timestamp: today } }, // Recent but tab not opened -> keep (recent)
        { tabId: 0, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // Expired and tab not opened -> delete
        { tabId: 1, data: { timestamp: new Date(today.getTime() - (5 * dayMs)) } }, // Recent and tab opened -> keep
        { tabId: 5, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // Expired and tab not opened -> delete
        { tabId: 2, data: { timestamp: new Date(today.getTime() - (7 * dayMs)) } }, // Recent and tab opened -> keep
        { tabId: 3, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // Expired but tab opened -> keep
        { tabId: 4, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // Expired and tab not opened -> delete
        { tabId: 6, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs)) } }, // Recent -> keep
        { tabId: 7, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs)) } } // Recent -> keep
      ];

      const filterFunction = dbCleanup_filterFdsResults(openedTabIds);
      const result = filterFunction(fdsFromDb);

      expect(result).toEqual([
        [0], // Expired and tab not opened
        [5], // Expired and tab not opened
        [4]  // Expired and tab not opened
      ]);
    });

    it('should handle timestamp as number type', () => {
      const openedTabIds: { [tabId: number]: number } = {
        1: 1
      };

      const today = new Date();
      const expiredTimestamp = today.getTime() - (TWO_WEEKS_MS + 86400000); // Expired

      const fdsFromDb: IDBFdsValueType[] = [
        { tabId: 0, data: { timestamp: expiredTimestamp } }, // Expired timestamp as number
        { tabId: 1, data: { timestamp: today.getTime() } }   // Recent timestamp as number
      ];

      const filterFunction = dbCleanup_filterFdsResults(openedTabIds);
      const result = filterFunction(fdsFromDb);

      expect(result).toEqual([
        [0] // Only expired entry should be marked for deletion
      ]);
    });
  });

  describe('Full Cleanup Integration', () => {
    it('should call chrome.tabs.query for cleanup process', () => {
      // Mock chrome.tabs.query to execute callback immediately
      const mockTabs = [
        { id: 1, url: 'https://example.com' },
        { id: 2, url: 'https://google.com' }
      ];

      (global as any).chrome = {
        tabs: {
          query: jest.fn((options, callback) => {
            // Execute callback immediately in synchronous manner for testing
            setTimeout(() => callback(mockTabs), 0);
          })
        }
      };

      // Mock database operations to complete immediately
      mockDatabase.queryIndexByRange.mockImplementation((config, callback) => {
        setTimeout(() => callback([]), 0);
      });

      // Mock setTimeout to prevent actual delays
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((fn, delay) => {
        if (delay === 1000 * 60 * 60 * 24) {
          // Don't schedule next cleanup in tests
          return 1;
        }
        // For other timeouts, execute immediately
        if (delay === 0) {
          return originalSetTimeout(fn, 0);
        }
        return 1;
      }) as any;

      try {
        // Start cleanup but don't await (avoid timeout)
        const promise = cleanupDB();

        // Verify that chrome.tabs.query was called
        expect((global as any).chrome.tabs.query).toHaveBeenCalledWith(
          {},
          expect.any(Function)
        );

        // Clean up the promise (but don't wait for it)
        promise.catch(() => {}); // Ignore any errors

      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input arrays', () => {
      const usedSessionIds = {};
      const usedTabIds = {};
      const screensFromDb: IDBAddedOnIndexType[] = [];

      const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
      const result = filterFunction(screensFromDb);

      expect(result).toEqual([]);
    });

    it('should handle null/undefined dates gracefully', () => {
      const usedSessionIds = { 100: true };
      const usedTabIds = { 1: 100 };

      const screensFromDb: IDBAddedOnIndexType[] = [
        [1, 100, null],      // null date
        [2, 200, undefined], // undefined date (should be treated as null)
        [3, 300, '']         // empty string date
      ];

      const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
      const result = filterFunction(screensFromDb);

      // Should identify unused sessions/tabs regardless of date format
      expect(result).toContainEqual([2, 200, undefined]);
      expect(result).toContainEqual([3, 300, expect.any(Date)]);
    });

    it('should handle invalid date objects', () => {
      const openedTabIds = { 1: 1 };

      const fdsFromDb: IDBFdsValueType[] = [
        { tabId: 2, data: { timestamp: new Date('invalid-date') } },
        { tabId: 3, data: { timestamp: NaN } }
      ];

      const filterFunction = dbCleanup_filterFdsResults(openedTabIds);

      // Should not throw errors with invalid dates
      expect(() => {
        filterFunction(fdsFromDb);
      }).not.toThrow();
    });
  });
});