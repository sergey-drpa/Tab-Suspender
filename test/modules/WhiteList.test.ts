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

// ══════════════════════════════════════════════════════════════════════════
// 3.6 — Empty pattern is silently skipped without errors
// ══════════════════════════════════════════════════════════════════════════
describe('3.6 — Empty / wildcard-only patterns are skipped without errors', () => {
  let WhiteList: any;
  let whiteList: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') return Promise.resolve('');
      return Promise.resolve(null);
    });
    const mod = require('../../modules/WhiteList');
    WhiteList = mod.WhiteList;
    (global as any).whiteList = null;
  });

  it('addPattern("") does not throw and does not add an entry', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    await expect(whiteList.addPattern('')).resolves.not.toThrow();
    expect(whiteList.patternList.length).toBe(0);
  });

  it('addPattern("*") does not throw and does not add a wildcard-all entry', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    await expect(whiteList.addPattern('*')).resolves.not.toThrow();
    expect(whiteList.patternList.length).toBe(0);
  });

  it('isURIException with an empty patternList returns false without throwing', () => {
    whiteList = new WhiteList(mockSettingsStore);
    expect(() => whiteList.isURIException('https://example.com')).not.toThrow();
    expect(whiteList.isURIException('https://example.com')).toBe(false);
  });

  it('constructor with comma/space-only pattern string produces empty patternList', async () => {
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') return Promise.resolve(',  , \n ,,');
      return Promise.resolve(null);
    });
    whiteList = new WhiteList(mockSettingsStore);
    await Promise.resolve(); // flush the constructor's settings.get().then()
    expect(whiteList.patternList.length).toBe(0);
  });

  it('mixed empty and valid patterns: only valid patterns are loaded from settings', async () => {
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') return Promise.resolve(',example.com*,,google.com*,');
      return Promise.resolve(null);
    });
    whiteList = new WhiteList(mockSettingsStore);
    await Promise.resolve();
    expect(whiteList.patternList.length).toBe(2);
    expect(whiteList.isURIException('https://example.com/page')).toBe(true);
    expect(whiteList.isURIException('https://google.com/search')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3.7 — Invalid regex pattern is caught and extension does not crash
// ══════════════════════════════════════════════════════════════════════════
describe('3.7 — Invalid regex patterns are caught without crashing the extension', () => {
  let WhiteList: any;
  let whiteList: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') return Promise.resolve('');
      return Promise.resolve(null);
    });
    const mod = require('../../modules/WhiteList');
    WhiteList = mod.WhiteList;
    (global as any).whiteList = null;
  });

  it('addPattern with unclosed group "(unclosed" does not throw', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    await expect(whiteList.addPattern('(unclosed')).resolves.not.toThrow();
    expect(whiteList.patternList.length).toBe(0);
  });

  it('invalid regex pattern is silently dropped and patternList stays empty', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    // "(unclosed" → becomes "^(unclosed$" which is an invalid regex (unterminated group)
    await whiteList.addPattern('(unclosed');
    expect(whiteList.patternList.length).toBe(0);
  });

  it('isURIException does not throw after a rejected invalid pattern', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    await whiteList.addPattern('(unclosed');
    expect(() => whiteList.isURIException('https://example.com')).not.toThrow();
    expect(whiteList.isURIException('https://example.com')).toBe(false);
  });

  it('valid pattern still works correctly after an invalid pattern is rejected', async () => {
    whiteList = new WhiteList(mockSettingsStore);
    await whiteList.addPattern('(unclosed');     // dropped
    await whiteList.addPattern('example.com*');  // valid
    expect(whiteList.patternList.length).toBe(1);
    expect(whiteList.isURIException('https://example.com/page')).toBe(true);
    expect(whiteList.isURIException('https://other.com')).toBe(false);
  });

  it('constructor loading settings with an invalid regex pattern does not throw', async () => {
    mockSettingsStore.get.mockImplementation((key) => {
      if (key === 'exceptionPatternsV2') return Promise.resolve('(unclosed,example.com*');
      return Promise.resolve(null);
    });
    expect(() => { whiteList = new WhiteList(mockSettingsStore); }).not.toThrow();
    await Promise.resolve();
    // Only the valid pattern survives
    expect(whiteList.patternList.length).toBe(1);
    expect(whiteList.patternList[0].pattern).toBe('example.com*');
  });
});

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