/**
 * Probe test: check whether functions/classes become globals after require()
 * in Jest's jsdom environment for TabParkController.ts and PageStateRestoreController.ts
 */

import '../lib/Chrome';
import '../typing/global.d';

// Minimum globals needed before require'ing TabParkController / PageStateRestoreController

(global as any).sessionsPageUrl  = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl    = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl   = 'chrome-extension://test/history.html';
(global as any).parkUrl          = 'chrome-extension://test/park.html';
(global as any).publicExtensionUrl = 'chrome-extension://test/park.html';
(global as any).trace            = false;
(global as any).debug            = false;
(global as any).debugScreenCache = false;
(global as any).TSSessionId      = 123456;
(global as any).getScreenCache   = null;
(global as any).closeHistory     = [];
(global as any).parkHistory      = [];
(global as any).tabsMarkedForUnsuspend = [];
(global as any).TABS_MARKED_FOR_UNSUSPEND_TTL = 60000;

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
});

// LocalStore mock
(global as any).LocalStore = {
  set: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
(global as any).LocalStoreKeys = {
  PARK_HISTORY: 'parkHistory',
  CLOSE_HISTORY: 'closeHistory',
};

// tabManager mock with historyOpenerController
(global as any).tabManager = {
  historyOpenerController: {
    reloadHistoryPage: jest.fn(),
  },
  isExceptionTab: jest.fn().mockResolvedValue(false),
  getTabInfoOrCreate: jest.fn().mockReturnValue({ lstCapUrl: null }),
  markTabParked: jest.fn(),
};

// Other stubs needed by TabParkController
(global as any).TabManager = {
  isTabURLAllowedForPark: jest.fn().mockReturnValue(true),
  isTabParked: jest.fn().mockReturnValue(false),
};
(global as any).ScreenshotController = {
  isScreenExist: jest.fn(),
  getScreen: jest.fn(),
};
(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).settings = { get: jest.fn().mockResolvedValue(50) };
(global as any).formRestoreController = {
  collectPageState: jest.fn().mockResolvedValue({ videoTime: null }),
};

describe('Probe: globals after require()', () => {
  beforeAll(() => {
    require('../../modules/TabParkController');
    require('../../modules/PageStateRestoreController');
  });

  test('closeTab is a global function after requiring TabParkController', () => {
    const val = (global as any).closeTab;
    console.log('[PROBE] typeof (global as any).closeTab =', typeof val);
    // A plain function declaration in the module body becomes a global in jest/jsdom
    // because jsdom's global IS the jest global object when running without isolation
    expect(typeof val).toBe('function');
  });

  test('parkTab is a global function after requiring TabParkController', () => {
    const val = (global as any).parkTab;
    console.log('[PROBE] typeof (global as any).parkTab =', typeof val);
    expect(typeof val).toBe('function');
  });

  test('PageStateRestoreController is a global class after requiring PageStateRestoreController', () => {
    const val = (global as any).PageStateRestoreController;
    console.log('[PROBE] typeof (global as any).PageStateRestoreController =', typeof val);
    expect(typeof val).toBe('function');
  });
});
