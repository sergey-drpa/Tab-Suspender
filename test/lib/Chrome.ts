// Mock Chrome APIs for testing

const mockTab: chrome.tabs.Tab = {
  id: 1,
  windowId: 1,
  index: 0,
  url: 'https://example.com',
  title: 'Example',
  favIconUrl: 'https://example.com/favicon.ico',
  active: true,
  pinned: false,
  discarded: false,
  autoDiscardable: true,
  audible: false,
  groupId: -1,
  status: 'complete',
  highlighted: false,
  incognito: false,
  selected: true
};

const mockStorage = {
  local: {
    get: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined)
  }
};

const mockTabs = {
  onCreated: {
    addListener: jest.fn()
  },
  onReplaced: {
    addListener: jest.fn()
  },
  onUpdated: {
    addListener: jest.fn()
  },
  onRemoved: {
    addListener: jest.fn()
  },
  onActivated: {
    addListener: jest.fn()
  },
  get: jest.fn().mockImplementation((tabId, callback) => {
    if (callback) {
      callback({ ...mockTab, id: tabId });
    }
  }),
  update: jest.fn().mockResolvedValue(mockTab),
  reload: jest.fn().mockResolvedValue(undefined),
  getZoom: jest.fn().mockImplementation((tabId, callback) => {
    callback(1.0);
  }),
  setZoom: jest.fn().mockResolvedValue(undefined),
  sendMessage: jest.fn().mockResolvedValue(undefined)
};

const mockWindows = {
  getAll: jest.fn().mockImplementation((options, callback) => {
    const mockWindow = {
      id: 1,
      tabs: [mockTab]
    };
    callback([mockWindow]);
  })
};

const mockRuntime = {
  getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
  sendMessage: jest.fn().mockResolvedValue(undefined)
};

(global as any).chrome = {
  storage: mockStorage,
  tabs: mockTabs,
  windows: mockWindows,
  runtime: mockRuntime
};

// Mock DOM APIs - use Node.js built-in TextEncoder/TextDecoder
const NodeTextEncoder = require('util').TextEncoder;
const NodeTextDecoder = require('util').TextDecoder;
(global as any).TextEncoder = NodeTextEncoder;
(global as any).TextDecoder = NodeTextDecoder;
// Mock ReadableStream
(global as any).ReadableStream = jest.fn().mockImplementation((options) => {
  let controller;
  const readable = {
    getReader: () => ({
      read: jest.fn().mockImplementation(async () => {
        if (controller && controller._chunks && controller._chunks.length > 0) {
          return { value: controller._chunks.shift(), done: false };
        }
        return { done: true };
      })
    })
  };

  if (options && options.start) {
    controller = {
      _chunks: [],
      enqueue: jest.fn((chunk) => controller._chunks.push(chunk)),
      close: jest.fn()
    };
    options.start(controller);
  }

  return readable;
});

// Mock compression streams with simpler implementation
(global as any).CompressionStream = jest.fn().mockImplementation(() => ({
  writable: {
    getWriter: () => ({
      write: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    })
  },
  readable: {
    getReader: () => ({
      read: jest.fn().mockResolvedValue({
        value: new NodeTextEncoder().encode("compressed_data"),
        done: false
      })
    })
  }
}));

(global as any).DecompressionStream = jest.fn().mockImplementation(() => ({
  writable: {
    getWriter: () => ({
      write: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    })
  },
  readable: {
    getReader: () => ({
      read: jest.fn().mockResolvedValue({
        value: new NodeTextEncoder().encode("Hello, World!"),
        done: false
      })
    })
  }
}));

(global as any).Response = jest.fn().mockImplementation((body) => ({
  arrayBuffer: jest.fn().mockImplementation(async () => {
    const encoder = new NodeTextEncoder();
    const data = encoder.encode("Hello, World!");
    return data.buffer;
  })
}));

// Mock global functions and variables
global.btoa = jest.fn((str: string) => Buffer.from(str).toString('base64'));
global.atob = jest.fn((str: string) => Buffer.from(str, 'base64').toString());
(global as any).setInterval = jest.fn((fn: Function, ms: number) => 123);
(global as any).clearInterval = jest.fn();
(global as any).setTimeout = jest.fn((fn: Function, ms: number) => 456);
(global as any).Date.now = jest.fn(() => 1640995200000); // Fixed timestamp for testing

// Mock additional global functions required by the modules
(global as any).trackErrors = jest.fn();
(global as any).trackError = jest.fn();
(global as any).trackView = jest.fn();
(global as any).sql_error = jest.fn();
(global as any).hasLastError = jest.fn();
(global as any).versionCompare = jest.fn();
(global as any).isScreenExist = jest.fn();
(global as any).addScreen = jest.fn();
(global as any).getScreen = jest.fn();
(global as any).drawPreviewTile = jest.fn();
(global as any).html2canvas = jest.fn();
(global as any).Store = jest.fn();
(global as any).DBProvider = jest.fn();
(global as any).ADDED_ON_INDEX_NAME = 'test';
(global as any).SCREENS_BINARY_DB_NAME = 'test';