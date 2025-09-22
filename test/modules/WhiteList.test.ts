// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock global variables
(global as any).debug = false;

// Mock SettingsStore
const mockSettingsStore = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined)
};

// Mock SettingsPageController
(global as any).SettingsPageController = {
  reloadSettings: jest.fn().mockResolvedValue(undefined)
};

// Mock BrowserActionControl
(global as any).BrowserActionControl = jest.fn();
(global as any).ContextMenuController = {
  menuIdMap: {}
};
(global as any).pauseTics = 0;
(global as any).settings = mockSettingsStore;
(global as any).whiteList = null;

// Mock chrome notifications
(global as any).chrome.notifications = {
  clear: jest.fn(),
  create: jest.fn()
};

describe('Issue #36: Whitelist patterns with https:// prefix do not work', () => {
  let WhiteList: any;
  let whiteList: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset mock implementation to return empty patterns by default
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') {
        return Promise.resolve('');
      }
      return Promise.resolve(null);
    });

    // Re-import WhiteList module
    const WhiteListModule = require('../../modules/WhiteList');
    WhiteList = WhiteListModule.WhiteList;

    // Clear any existing whiteList
    (global as any).whiteList = null;
  });

  it('should fail: patterns with https:// prefix should whitelist URLs but do not work', () => {
    // This test demonstrates the exact Issue #36 scenario:
    // User adds pattern "https://www.youtube.com*" expecting it to whitelist "https://www.youtube.com/watch?v=abc123"
    // But due to the bug, it doesn't work.

    whiteList = new WhiteList(mockSettingsStore);

    const userPattern = 'www.youtube.com*';
    const userUrl = 'https://www.youtube.com/watch?v=abc123';

    whiteList.addPattern(userPattern);

    const result = whiteList.isURIException(userUrl);

    console.log(`\nResult: ,${result}`);
    console.log(`User pattern: "${userPattern}"`);
    console.log(`User URL: "${userUrl}"`);

    expect(result).toBe(true);
  });
});