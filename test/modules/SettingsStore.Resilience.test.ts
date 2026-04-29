// Tests: SettingsStore resilience to storage corruption and failures
// These tests document BUGS that exist in the current implementation.
// Run them BEFORE fixes to confirm they fail, then AFTER fixes to confirm they pass.
import '../lib/Chrome';
import '../typing/global.d';
import '../../fancy-settings/source/lib/store';
import '../../modules/Settings';

(global as any).debug = false;

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMockStorage(
  localData: Record<string, any> = {},
  syncData:  Record<string, any> = {}
) {
  return {
    local: {
      get: jest.fn().mockImplementation(async (keys: string | string[]) => {
        const result: Record<string, any> = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (localData[k] !== undefined) result[k] = localData[k];
        });
        return result;
      }),
      set: jest.fn().mockImplementation(async (data: Record<string, any>) => {
        Object.assign(localData, data);
      }),
      remove: jest.fn().mockImplementation(async (keys: string | string[]) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete localData[k]);
      }),
      clear: jest.fn().mockImplementation(async () => {
        Object.keys(localData).forEach(k => delete localData[k]);
      }),
    },
    sync: {
      // Handles both constructor call (null → all items) and per-key fallback calls
      get: jest.fn().mockImplementation(async (keys: string | string[] | null) => {
        if (keys === null) return { ...syncData };
        const result: Record<string, any> = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (syncData[k] !== undefined) result[k] = syncData[k];
        });
        return result;
      }),
      set: jest.fn().mockImplementation(async (data: Record<string, any>) => {
        Object.assign(syncData, data);
      }),
      remove: jest.fn().mockResolvedValue(undefined),
      clear:  jest.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: jest.fn() },
  };
}

function makeOffscreenProvider(oldSettings: Record<string, any> = {}) {
  return {
    extractOldSettings: jest.fn().mockResolvedValue(oldSettings),
    cleanupFormDatas:   jest.fn().mockResolvedValue(undefined),
  };
}

async function createStore(storage: any, oldSettings: Record<string, any> = {}) {
  (global as any).chrome.storage = storage;
  const store = new (global as any).SettingsStore(
    'tabSuspenderSettings',
    (global as any).DEFAULT_SETTINGS,
    makeOffscreenProvider(oldSettings)
  );
  await store.getOnStorageInitialized();
  return store;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('SettingsStore - Resilience to storage corruption and failures', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Bug 1 ──────────────────────────────────────────────────────────────────
  // onStorageInitialized hangs forever when chrome.storage.sync.get() rejects.
  // The resolve() callback is only inside .then(); .catch() swallows the error
  // but never calls resolve(), leaving the Promise permanently pending.
  describe('Bug 1: onStorageInitialized hangs when sync.get() fails', () => {

    it('should resolve (not hang) when chrome.storage.sync.get() rejects', async () => {
      const storage = makeMockStorage();
      storage.sync.get = jest.fn().mockRejectedValue(new Error('Network unavailable'));
      (global as any).chrome.storage = storage;

      const store = new (global as any).SettingsStore(
        'tabSuspenderSettings',
        (global as any).DEFAULT_SETTINGS,
        makeOffscreenProvider()
      );

      await expect(
        Promise.race([
          store.getOnStorageInitialized(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT: onStorageInitialized never resolved')), 2000)
          ),
        ])
      ).resolves.toBeUndefined();
    });

    it('should still initialize settings with defaults after sync.get() failure', async () => {
      const storage = makeMockStorage();
      storage.sync.get = jest.fn().mockRejectedValue(new Error('Network unavailable'));
      (global as any).chrome.storage = storage;

      const store = new (global as any).SettingsStore(
        'tabSuspenderSettings',
        (global as any).DEFAULT_SETTINGS,
        makeOffscreenProvider()
      );
      await store.getOnStorageInitialized();

      const active  = await store.get('active');
      const timeout = await store.get('timeout');
      expect(active).toBe((global as any).DEFAULT_SETTINGS.active);
      expect(timeout).toBe((global as any).DEFAULT_SETTINGS.timeout);
    });
  });

  // ── Bug 2 ──────────────────────────────────────────────────────────────────
  // set() uses .catch(console.error) on chrome.storage.local.set(), so write
  // failures are silently swallowed.  The user sees the setting saved in the UI
  // but the value was never persisted — next restart reads stale data.
  describe('Bug 2: set() silently swallows chrome.storage.local write errors', () => {

    it('should reject when chrome.storage.local.set() fails', async () => {
      const storage = makeMockStorage();
      const store   = await createStore(storage);

      // Sabotage writes after successful init
      storage.local.set = jest.fn().mockRejectedValue(
        new Error('QUOTA_BYTES_PER_ITEM exceeded')
      );

      await expect(store.set('active', false)).rejects.toThrow('QUOTA_BYTES_PER_ITEM exceeded');
    });

    it('caller should be able to detect a failed write and not assume data was saved', async () => {
      const storage = makeMockStorage();
      const store   = await createStore(storage);

      storage.local.set = jest.fn().mockRejectedValue(new Error('Disk full'));

      let errorCaught = false;
      try {
        await store.set('active', false);
      } catch {
        errorCaught = true;
      }

      // Without error propagation, errorCaught is always false —
      // the caller has no way to know the write failed.
      expect(errorCaught).toBe(true);
    });
  });

  // ── Bug 3 ──────────────────────────────────────────────────────────────────
  // When local storage is empty/corrupted, initOrMigrateSettings resets every
  // setting to DEFAULT_SETTINGS — including active: true.  Users who had
  // auto-suspension disabled suddenly have it re-enabled after a Chrome crash,
  // disk-full partial write, or profile repair that clears extension storage.
  //
  // Fix: before falling back to DEFAULT_SETTINGS, try chrome.storage.sync as a
  // secondary source (setSync already writes user preferences there).
  describe('Bug 3: active=false resets to true when local storage is corrupted', () => {

    it('should restore active=false from sync when local storage is empty (corruption)', async () => {
      // Simulate: local storage wiped (crash / disk-full corruption)
      //           sync still holds the user's last-written preference
      const syncData  = { active: false };
      const storage   = makeMockStorage({}, syncData); // local empty, sync has value

      const store = await createStore(storage);

      // active must be false (sync fallback), NOT true (DEFAULT_SETTINGS)
      expect(await store.get('active')).toBe(false);
    });

    it('should restore a large timeout from sync when local storage is corrupted', async () => {
      const syncData = { timeout: 7200 }; // user had 2-hour timeout
      const storage  = makeMockStorage({}, syncData);

      const store = await createStore(storage);

      // timeout must be 7200 (from sync), NOT 1800 (DEFAULT_SETTINGS)
      expect(await store.get('timeout')).toBe(7200);
    });

    it('should use DEFAULT_SETTINGS when both local and sync are empty (first install)', async () => {
      const storage = makeMockStorage({}, {}); // both empty

      const store = await createStore(storage);

      expect(await store.get('active')).toBe(true);   // default
      expect(await store.get('timeout')).toBe(1800);  // default: 30 * 60
    });

    it('should NOT overwrite active=false when local storage already has it correctly', async () => {
      // Normal operation: user set active=false, it was persisted correctly
      const localData: Record<string, any> = {
        'store.tabSuspenderSettings.active': false,
      };
      const storage = makeMockStorage(localData, {});

      const store = await createStore(storage);

      // Must remain false — not overwritten with DEFAULT_SETTINGS.active = true
      expect(await store.get('active')).toBe(false);
    });

    it('should NOT overwrite a valid timeout even when type-guard would otherwise reset it', async () => {
      // Regression guard: make sure a correctly typed stored value is never replaced
      const localData: Record<string, any> = {
        'store.tabSuspenderSettings.timeout': 3600, // 1-hour custom timeout
      };
      const storage = makeMockStorage(localData, {});

      const store = await createStore(storage);

      expect(await store.get('timeout')).toBe(3600);
    });
  });
});
