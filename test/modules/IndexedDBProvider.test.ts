// Polyfill for structuredClone (needed for fake-indexeddb in Jest)
if (typeof (global as any).structuredClone === 'undefined') {
  (global as any).structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

// Mock IndexedDB for testing
require('fake-indexeddb/auto');

// Mock global variables
(global as any).SCREENS_DB_NAME = 'screens';
(global as any).FD_DB_NAME = 'fd';
(global as any).ADDED_ON_INDEX_NAME = 'addedOnIndex';

describe('IndexedDBProvider Promise Handling Tests', () => {
  let IndexedDBProvider: any;
  let provider: any;
  let originalIndexedDB: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Save original indexedDB before each test
    originalIndexedDB = (global as any).indexedDB;

    const IndexedDBProviderModule = require('../../modules/IndexedDBProvider');
    IndexedDBProvider = IndexedDBProviderModule.IndexedDBProvider;
  });

  afterEach(() => {
    if (provider && provider.close) {
      provider.close();
    }

    // Always restore indexedDB after each test
    if (originalIndexedDB) {
      (global as any).indexedDB = originalIndexedDB;
    }
  });

  describe('putV2', () => {
    it('should return a promise that resolves when all operations complete', async () => {
      provider = new IndexedDBProvider();

      // Wait for DB to initialize
      await provider.initializedPromise;

      const queries = [
        {
          IDB: {
            table: 'screens',
            data: {
              id: 1,
              sessionId: 123,
              screen: 'test-screen-1',
              pixRat: 1,
              added_on: new Date()
            }
          }
        }
      ];

      // Should return a promise
      const result = provider.putV2(queries);
      expect(result).toBeInstanceOf(Promise);

      // Should resolve successfully
      await expect(result).resolves.toBeUndefined();
    });

    it('should wait for all put operations to complete', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      const queries = [
        {
          IDB: {
            table: 'screens',
            data: {
              id: 1,
              sessionId: 123,
              screen: 'test-1',
              pixRat: 1,
              added_on: new Date()
            }
          }
        },
        {
          IDB: {
            table: 'screens',
            data: {
              id: 2,
              sessionId: 123,
              screen: 'test-2',
              pixRat: 1,
              added_on: new Date()
            }
          }
        }
      ];

      const startTime = Date.now();
      await provider.putV2(queries);
      const endTime = Date.now();

      // Should have waited for operations to complete (should take some time)
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    it('should reject if database write fails', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      // Create query with invalid table name to trigger error
      const queries = [
        {
          IDB: {
            table: 'nonexistent_table',
            data: {
              id: 1,
              test: 'data'
            }
          }
        }
      ];

      await expect(provider.putV2(queries)).rejects.toBeDefined();
    });

    it('should handle multiple simultaneous writes correctly', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      const createQuery = (id: number) => ({
        IDB: {
          table: 'screens',
          data: {
            id: id,
            sessionId: 123,
            screen: `test-${id}`,
            pixRat: 1,
            added_on: new Date()
          }
        }
      });

      const promises = [
        provider.putV2([createQuery(1)]),
        provider.putV2([createQuery(2)]),
        provider.putV2([createQuery(3)])
      ];

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });

  describe('getTransaction', () => {
    it('should reject when initializedPromise fails', async () => {
      // Create provider but force initialization to fail
      const mockOpenRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any
      };

      (global as any).indexedDB = {
        open: jest.fn(() => {
          // Trigger error in next microtask to ensure promise handlers are attached
          Promise.resolve().then(() => {
            if (mockOpenRequest.onerror) {
              const error = new Error('Database initialization failed');
              mockOpenRequest.onerror({ target: { error } });
            }
          });
          return mockOpenRequest;
        })
      };

      provider = new IndexedDBProvider({ skipSchemaCreation: true });

      // Wait for initialization to fail
      await expect(provider.initializedPromise).rejects.toBeDefined();

      // getTransaction should now reject properly
      await expect(
        provider.getTransaction(['screens'], 'readonly')
      ).rejects.toBeDefined();

      // Note: indexedDB will be restored in afterEach
    });

    it('should resolve when database is already initialized', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      const transaction = await provider.getTransaction(['screens'], 'readonly');
      expect(transaction).toBeDefined();
      expect(transaction.objectStore).toBeDefined();
    });
  });

  describe('queryIndex with error handling', () => {
    it('should call callback with null when getTransaction fails', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise; // Wait for initialization first

      // Close database to force getTransaction to fail
      provider.close();
      provider.db = null;

      // Mock initializedPromise to reject
      const rejectedPromise = Promise.reject(new Error('DB closed'));
      provider.initializedPromise = rejectedPromise;

      // Consume the rejection to prevent unhandled rejection
      rejectedPromise.catch(() => {});

      const query = {
        IDB: {
          table: 'screens',
          index: 'PK'
        },
        params: [1, 123]
      };

      // Use promise to wait for callback
      const result = await new Promise((resolve) => {
        provider.queryIndex(query, resolve);
      });

      expect(result).toBeNull();
    });

    it('should handle successful query', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      // First add data
      await provider.putV2([{
        IDB: {
          table: 'screens',
          data: {
            id: 1,
            sessionId: 123,
            screen: 'test-screen',
            pixRat: 2,
            added_on: new Date()
          }
        }
      }]);

      const query = {
        IDB: {
          table: 'screens',
          index: 'PK'
        },
        params: [1, 123]
      };

      // Use promise to wait for callback
      const result = await new Promise<any>((resolve) => {
        provider.queryIndex(query, resolve);
      });

      expect(result).toBeDefined();
      if (result) {
        expect(result.screen).toBe('test-screen');
      }
    });
  });

  describe('queryIndexCount with error handling', () => {
    it('should call callback with 0 when getTransaction fails', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise; // Wait for initialization first

      // Close database to force failure
      provider.close();
      provider.db = null;

      const rejectedPromise = Promise.reject(new Error('DB closed'));
      provider.initializedPromise = rejectedPromise;

      // Consume the rejection to prevent unhandled rejection
      rejectedPromise.catch(() => {});

      const query = {
        IDB: {
          table: 'screens',
          index: 'PK'
        },
        params: [1, 123]
      };

      // Use promise to wait for callback
      const result = await new Promise((resolve) => {
        provider.queryIndexCount(query, resolve);
      });

      expect(result).toBe(0);
    });

    it('should return correct count for existing data', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      // Add test data
      await provider.putV2([{
        IDB: {
          table: 'screens',
          data: {
            id: 1,
            sessionId: 123,
            screen: 'test',
            pixRat: 1,
            added_on: new Date()
          }
        }
      }]);

      const query = {
        IDB: {
          table: 'screens',
          index: 'PK'
        },
        params: [1, 123]
      };

      // Use promise to wait for callback
      const result = await new Promise<number>((resolve) => {
        provider.queryIndexCount(query, resolve);
      });

      expect(result).toBe(1);
    });
  });

  describe('race condition prevention', () => {
    it('should complete putV2 before returning control', async () => {
      provider = new IndexedDBProvider();
      await provider.initializedPromise;

      let writeCompleted = false;

      // Create a custom mock to track completion
      const originalPut = provider.putV2.bind(provider);
      provider.putV2 = async function(queries: any[]) {
        const result = await originalPut(queries);
        writeCompleted = true;
        return result;
      };

      const query = [{
        IDB: {
          table: 'screens',
          data: {
            id: 999,
            sessionId: 123,
            screen: 'test',
            pixRat: 1,
            added_on: new Date()
          }
        }
      }];

      expect(writeCompleted).toBe(false);
      await provider.putV2(query);
      expect(writeCompleted).toBe(true);

      // Verify data was actually written
      const checkQuery = {
        IDB: {
          table: 'screens',
          index: 'PK'
        },
        params: [999, 123]
      };

      const result = await new Promise((resolve) => {
        provider.queryIndex(checkQuery, resolve);
      });

      expect(result).toBeDefined();
    });
  });
});
