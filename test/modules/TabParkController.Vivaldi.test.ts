/**
 * TabParkController — Vivaldi detection unit tests
 *
 * Covers code review fix #8: isVivaldiBrowser() must not cache a permanent
 * `false` when chrome.windows.getCurrent() fails transiently (e.g. the SW
 * wakes before any window is focused). A cached false silently disables the
 * Vivaldi discard block, bringing back the chrome.tabs.discard() vs native
 * hibernation SIGTRAP crashes.
 */

import '../typing/global.d';

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

(global as any).LocalStore = {
  set: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
(global as any).LocalStoreKeys = { PARK_HISTORY: 'parkHistory', CLOSE_HISTORY: 'closeHistory' };

(global as any).tabManager = {
  historyOpenerController: { reloadHistoryPage: jest.fn() },
  isExceptionTab: jest.fn().mockResolvedValue(false),
  getTabInfoOrCreate: jest.fn().mockReturnValue({ lstCapUrl: null }),
  markTabParked: jest.fn(),
};

(global as any).TabManager = {
  isTabURLAllowedForPark: jest.fn().mockReturnValue(true),
  isTabParked: jest.fn().mockReturnValue(false),
};

(global as any).ScreenshotController = { isScreenExist: jest.fn() };
(global as any).formRestoreController = {
  collectPageState: jest.fn().mockResolvedValue({ videoTime: null }),
};
(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).settings   = { get: jest.fn().mockResolvedValue(50) };
(global as any).tabsMarkedForUnsuspend = [];
(global as any).TABS_MARKED_FOR_UNSUSPEND_TTL = 60000;

// discardTab needs these and the shared Chrome.ts mock lacks them.
(global as any).chrome.tabs.remove  = jest.fn();
(global as any).chrome.tabs.discard = jest.fn().mockImplementation((_tabId: number, cb?: () => void) => {
  cb?.();
});
(global as any).chrome.tabs.query    = jest.fn().mockResolvedValue([]);
(global as any).chrome.windows.getCurrent = jest.fn();

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 42,
    windowId: 1,
    index: 0,
    url: 'https://example.com/page',
    title: 'Example Page',
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

let discardTabFn: (tabId: number) => Promise<void>;

describe('TabParkController — isVivaldiBrowser / discardTab', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    (chrome.tabs.get as jest.Mock).mockReset();
    (chrome.tabs.get as jest.Mock).mockImplementation(async (tabId: number) => makeTab({ id: tabId }));
    (chrome.tabs.query as jest.Mock).mockReset();
    (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabs.discard as jest.Mock).mockClear();
    ((chrome as any).windows.getCurrent as jest.Mock).mockClear();

    require('../../modules/TabParkController');
    discardTabFn = (global as any).discardTab;
  });

  it('discards on plain Chrome (no vivExtData) and caches the negative result after one query', async () => {
    ((chrome as any).windows.getCurrent as jest.Mock).mockResolvedValue({ id: 1 });

    await discardTabFn(42);
    expect(chrome.tabs.discard).toHaveBeenCalledTimes(1);

    // Cached negative: a second discard must not re-query the window.
    await discardTabFn(43);
    expect(chrome.tabs.discard).toHaveBeenCalledTimes(2);
    expect((chrome as any).windows.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('blocks discard on Vivaldi (vivExtData present)', async () => {
    ((chrome as any).windows.getCurrent as jest.Mock).mockResolvedValue({ id: 1, vivExtData: '{}' });

    await discardTabFn(42);
    expect(chrome.tabs.discard).not.toHaveBeenCalled();
  });

  it('does NOT cache false when getCurrent() fails transiently — a later successful check still detects Vivaldi', async () => {
    // First call: no focused window yet → getCurrent rejects.
    ((chrome as any).windows.getCurrent as jest.Mock)
      .mockRejectedValueOnce(new Error('No last-focused window'))
      .mockResolvedValueOnce({ id: 1, vivExtData: '{}' });

    await discardTabFn(42);
    // Transient failure means "unknown", not "not Vivaldi" → no discard either way
    // (conservative), but the result must not be cached.
    expect(chrome.tabs.discard).not.toHaveBeenCalled();

    await discardTabFn(43);
    expect((chrome as any).windows.getCurrent).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.discard).not.toHaveBeenCalled();
  });
});