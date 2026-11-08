/**
 * TabParkController — History Unit Tests
 *
 * Covers TEST_CASES.md sections:
 *   8.4  — Closed tab adds entry to closeHistory (up to 300 entries, LIFO)
 *   12.7 — parkHistory limited to 300 entries (LIFO, older items dropped)
 */

import '../lib/Chrome';
import '../typing/global.d';

// ─── Globals setup ───────────────────────────────────────────────────────────

(global as any).sessionsPageUrl    = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl      = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl     = 'chrome-extension://test/history.html';
(global as any).parkUrl            = 'chrome-extension://test/park.html';
(global as any).publicExtensionUrl = 'chrome-extension://test/park.html';
(global as any).trace              = false;
(global as any).debug              = false;
(global as any).debugScreenCache   = false;
(global as any).TSSessionId        = 123456;
(global as any).getScreenCache     = null;

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
});

// LocalStore mock — set() must return a resolved Promise (closeTab chains .then)
const mockLocalStoreSet = jest.fn().mockResolvedValue(undefined);
(global as any).LocalStore = {
  set: mockLocalStoreSet,
  get: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
(global as any).LocalStoreKeys = {
  PARK_HISTORY: 'parkHistory',
  CLOSE_HISTORY: 'closeHistory',
};

// tabManager mock with historyOpenerController.reloadHistoryPage
const mockReloadHistoryPage = jest.fn();
(global as any).tabManager = {
  historyOpenerController: { reloadHistoryPage: mockReloadHistoryPage },
  isExceptionTab: jest.fn().mockResolvedValue(false),
  getTabInfoOrCreate: jest.fn().mockReturnValue({ lstCapUrl: null }),
  markTabParked: jest.fn(),
};

// TabManager static helpers
(global as any).TabManager = {
  isTabURLAllowedForPark: jest.fn().mockReturnValue(true),
  isTabParked: jest.fn().mockReturnValue(false),
};

// ScreenshotController — isScreenExist just hangs (we only care about history, not the capture path)
(global as any).ScreenshotController = {
  isScreenExist: jest.fn(), // does not call callback → capture path never runs
};

// formRestoreController — collectPageState resolves with no videoTime
(global as any).formRestoreController = {
  collectPageState: jest.fn().mockResolvedValue({ videoTime: null }),
};

(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).settings   = { get: jest.fn().mockResolvedValue(50) };
(global as any).tabsMarkedForUnsuspend = [];
(global as any).TABS_MARKED_FOR_UNSUSPEND_TTL = 60000;

// chrome.tabs.remove is not in the shared Chrome.ts mock — add it
(global as any).chrome.tabs.remove = jest.fn();

// ─── Load module (makes closeTab, parkTab global) ────────────────────────────

// We reset modules in beforeEach so the module re-runs cleanly each test
let closeTabFn: (tabId: number, tab: chrome.tabs.Tab) => void;
let parkTabFn:  (tab: chrome.tabs.Tab, tabId: number, options?: any) => Promise<void>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 42,
    windowId: 1,
    index: 0,
    url: 'https://example.com/page?q=1',
    title: 'Example Page',
    favIconUrl: 'https://example.com/favicon.ico',
    active: false,
    pinned: false,
    discarded: false,
    autoDiscardable: true,
    audible: false,
    groupId: -1,
    status: 'complete',
    highlighted: false,
    incognito: false,
    selected: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

/**
 * Make a parked tab whose URL encodes the original tabId and sessionId.
 */
function makeParkedTab(tabId: number, sessionId: number, originalUrl: string): chrome.tabs.Tab {
  const parkUrl = `chrome-extension://test/park.html?tabId=${tabId}&sessionId=${sessionId}&url=${encodeURIComponent(originalUrl)}`;
  return makeTab({ id: tabId, url: parkUrl });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8.4 — closeTab adds entry to closeHistory
// ─────────────────────────────────────────────────────────────────────────────

describe('8.4 — closeTab adds entry to closeHistory', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Reset the history arrays on global (as background.ts would do at startup)
    (global as any).closeHistory = [];
    (global as any).parkHistory  = [];

    require('../../modules/TabParkController');
    closeTabFn = (global as any).closeTab;
  });

  it('adds one entry to closeHistory when a parked tab is closed', () => {
    const tab = makeParkedTab(42, 123456, 'https://example.com');
    closeTabFn(42, tab);

    const hist: any[] = (global as any).closeHistory;
    expect(hist.length).toBe(1);
  });

  it('entry contains url, title, tabId (parsed from URL param), sessionId, and timestamp', () => {
    const originalUrl = 'https://example.com/page';
    const tab = makeParkedTab(42, 123456, originalUrl);
    closeTabFn(42, tab);

    const entry = (global as any).closeHistory[0];
    expect(entry).toMatchObject({
      url:       tab.url,
      title:     tab.title,
      tabId:     '42',       // parseUrlParam returns string
      sessionId: '123456',   // parseUrlParam returns string
    });
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('newest entry appears at index 0 (LIFO order)', () => {
    const tab1 = makeParkedTab(1, 111, 'https://first.com');
    const tab2 = makeParkedTab(2, 222, 'https://second.com');

    closeTabFn(1, tab1);
    closeTabFn(2, tab2);

    const hist: any[] = (global as any).closeHistory;
    expect(hist[0].tabId).toBe('2'); // most-recent first
    expect(hist[1].tabId).toBe('1');
  });

  it('calls LocalStore.set with CLOSE_HISTORY key after adding entry', async () => {
    const tab = makeParkedTab(42, 123456, 'https://example.com');
    closeTabFn(42, tab);

    // LocalStore.set is called synchronously inside closeTab before the .then()
    expect(mockLocalStoreSet).toHaveBeenCalledWith(
      'closeHistory',
      (global as any).closeHistory,
    );
  });

  it('calls reloadHistoryPage() after LocalStore.set resolves', async () => {
    const tab = makeParkedTab(42, 123456, 'https://example.com');
    closeTabFn(42, tab);

    // Wait for the Promise.then() chain to resolve
    await Promise.resolve();

    expect(mockReloadHistoryPage).toHaveBeenCalledTimes(1);
  });

  it('caps closeHistory at 300 entries — adding a 301st drops the oldest', () => {
    // Pre-fill with 300 entries
    const hist: any[] = [];
    for (let i = 0; i < 300; i++) {
      hist.push({ timestamp: i, url: `https://old${i}.com`, title: `Old ${i}`, tabId: String(i), sessionId: '0' });
    }
    (global as any).closeHistory = hist;

    const newTab = makeParkedTab(999, 123456, 'https://newest.com');
    closeTabFn(999, newTab);

    const updated: any[] = (global as any).closeHistory;
    expect(updated.length).toBe(300);
    expect(updated[0].tabId).toBe('999'); // newest is first
  });

  it('caps closeHistory at 300 entries when starting from empty and adding 305', () => {
    for (let i = 0; i < 305; i++) {
      const tab = makeParkedTab(i, i, `https://site${i}.com`);
      closeTabFn(i, tab);
    }

    expect((global as any).closeHistory.length).toBe(300);
    // Most recent call was i=304
    expect((global as any).closeHistory[0].tabId).toBe('304');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 12.7 — parkHistory limited to 300 entries (LIFO)
// ─────────────────────────────────────────────────────────────────────────────

describe('12.7 — parkHistory limited to 300 entries (LIFO)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    (global as any).closeHistory = [];
    (global as any).parkHistory  = [];

    // Reset formRestoreController to avoid duplicate detection issues
    (global as any).formRestoreController = {
      collectPageState: jest.fn().mockResolvedValue({ videoTime: null }),
    };

    require('../../modules/TabParkController');
    parkTabFn = (global as any).parkTab;
  });

  /**
   * Call parkTab and wait for the history-writing async portion to complete.
   * (History is written inside the try block which resolves after collectPageState.)
   */
  async function callParkTab(tab: chrome.tabs.Tab, tabId: number, sessionId?: number) {
    // Temporarily switch TSSessionId if provided
    const origSession = (global as any).TSSessionId;
    if (sessionId !== undefined) (global as any).TSSessionId = sessionId;

    await parkTabFn(tab, tabId);

    if (sessionId !== undefined) (global as any).TSSessionId = origSession;

    // Flush microtasks so the collectPageState promise resolves
    await Promise.resolve();
    await Promise.resolve();
  }

  it('adds one entry to parkHistory when parkTab is called', async () => {
    const tab = makeTab({ id: 1, url: 'https://example.com' });
    await callParkTab(tab, 1);

    expect((global as any).parkHistory.length).toBe(1);
  });

  it('entry contains url, title, tabId, sessionId, and timestamp', async () => {
    const tab = makeTab({ id: 7, url: 'https://mysite.com', title: 'My Site' });
    await callParkTab(tab, 7);

    const entry = (global as any).parkHistory[0];
    expect(entry).toMatchObject({
      url:       'https://mysite.com',
      title:     'My Site',
      tabId:     7,
      sessionId: 123456,
    });
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('newest entry appears at index 0 (LIFO order)', async () => {
    // Use different tabIds to avoid duplicate detection (same tabId+sessionId = skip)
    const tab1 = makeTab({ id: 1, url: 'https://first.com', title: 'First' });
    const tab2 = makeTab({ id: 2, url: 'https://second.com', title: 'Second' });

    await callParkTab(tab1, 1);
    await callParkTab(tab2, 2);

    const hist: any[] = (global as any).parkHistory;
    expect(hist.length).toBe(2);
    expect(hist[0].tabId).toBe(2); // most-recent first
    expect(hist[1].tabId).toBe(1);
  });

  it('does NOT add duplicate: same tabId + same sessionId is skipped', async () => {
    const tab = makeTab({ id: 10, url: 'https://dup.com' });
    await callParkTab(tab, 10);
    await callParkTab(tab, 10); // duplicate call

    expect((global as any).parkHistory.length).toBe(1);
  });

  it('caps parkHistory at 300 when 305 distinct tabs are parked', async () => {
    // Park 305 tabs with distinct IDs to avoid duplicate detection
    for (let i = 0; i < 305; i++) {
      const tab = makeTab({ id: i + 1000, url: `https://site${i}.com`, title: `Site ${i}` });
      await callParkTab(tab, i + 1000, i); // unique sessionId per call defeats duplicate check
    }

    const hist: any[] = (global as any).parkHistory;
    expect(hist.length).toBe(300);
  });

  it('caps parkHistory at 300 — oldest entries (highest index) are dropped', async () => {
    // Park 305 tabs
    for (let i = 0; i < 305; i++) {
      const tab = makeTab({ id: i + 2000, url: `https://site${i}.com`, title: `Site ${i}` });
      await callParkTab(tab, i + 2000, i);
    }

    const hist: any[] = (global as any).parkHistory;
    // The first parked entries (i=0..4) should have been dropped
    // Most recent entry (i=304) should be at index 0
    expect(hist[0].tabId).toBe(304 + 2000);
    // Should contain exactly 300 entries
    expect(hist.length).toBe(300);
  });

  it('calls LocalStore.set with PARK_HISTORY key after each park', async () => {
    const tab = makeTab({ id: 50, url: 'https://stored.com' });
    await callParkTab(tab, 50);

    expect(mockLocalStoreSet).toHaveBeenCalledWith(
      'parkHistory',
      expect.arrayContaining([expect.objectContaining({ tabId: 50 })]),
    );
  });
});
