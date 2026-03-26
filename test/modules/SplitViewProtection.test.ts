/**
 * Chrome Split View Protection Test
 *
 * PURPOSE: Prevent automatic discard of tabs in Split View (Chrome 145+)
 *
 * PROBLEM: When a tab in Split View is automatically discarded, it becomes a black screen
 * and cannot be recovered. The user has to close and reopen the tab.
 *
 * SOLUTION: Check tab.splitViewId before discard. If tab is in Split View (splitViewId !== -1),
 * skip automatic suspension and discard.
 *
 * BACKWARD COMPATIBILITY: For Chrome versions < 145 without splitViewId API, the check
 * safely falls back to undefined and allows normal operation.
 */

// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Mock global variables and functions before importing
(global as any).sessionsPageUrl = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl = 'chrome-extension://test/history.html';
(global as any).parkUrl = 'chrome-extension://test/park.html';
(global as any).trace = false;
(global as any).debug = false;
(global as any).debugScreenCache = false;
(global as any).TSSessionId = 123456;
(global as any).getScreenCache = null;

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

(global as any).discardTab = jest.fn();
(global as any).markForUnsuspend = jest.fn();

// Mock global objects
(global as any).settings = {
	get: jest.fn((key: string) => {
		if (key === 'ignoreSuspendSplitViewTabs') return Promise.resolve(true);
		return Promise.resolve(false);
	})
};

(global as any).whiteList = {
	isURIException: jest.fn().mockReturnValue(false)
};

(global as any).ignoreList = {
	isTabInIgnoreTabList: jest.fn().mockReturnValue(false)
};

(global as any).tabCapture = {
	captureTab: jest.fn(),
	injectJS: jest.fn()
};

(global as any).ContextMenuController = {
	menuIdMap: {}
};

(global as any).pauseTics = 0;

(global as any).ScreenshotController = {
	getScreen: jest.fn()
};

const BrowserActionControl = jest.fn().mockImplementation(() => ({
	updateStatus: jest.fn()
}));

const HistoryOpenerController = jest.fn().mockImplementation(() => ({
	onNewTab: jest.fn(),
	onTabUpdate: jest.fn(),
	onRemoveTab: jest.fn(),
	collectInitialTabState: jest.fn()
}));

const TabObserver = {
	tickSize: 1000
};

// Make classes available globally
(global as any).BrowserActionControl = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;
(global as any).TabObserver = TabObserver;

describe('Chrome Split View Protection', () => {
	let tabManager: any;
	let TabManager: any;
	let TabInfo: any;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.resetModules();

		// Clear global variables
		(global as any).getScreenCache = null;
		((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

		// Re-import modules
		const TabInfoModule = require('../../modules/model/TabInfo');
		TabInfo = TabInfoModule.TabInfo;

		// Make TabInfo available globally
		(global as any).TabInfo = TabInfo;

		const TabManagerModule = require('../../modules/TabManager');
		TabManager = TabManagerModule.TabManager;

		tabManager = new TabManager();

		// Make tabManager available globally
		(global as any).tabManager = tabManager;
	});

	describe('Split View API Backward Compatibility', () => {
		it('should handle Chrome versions without splitViewId API', async () => {
			// Simulate old Chrome version without splitViewId
			const mockTab: chrome.tabs.Tab = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				favIconUrl: '',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false
				// No splitViewId property
			};

			// Should not throw error and should return false (not an exception)
			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(false);
		});

		it('should handle Chrome 145+ with SPLIT_VIEW_ID_NONE constant', async () => {
			// Mock Chrome 145+ with SPLIT_VIEW_ID_NONE constant
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				favIconUrl: '',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: -1, // Not in Split View
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false
			};

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(false); // Not in Split View, can be suspended
		});
	});

	describe('Split View Tab Detection', () => {
		it('should detect tab in ACTIVE Split View and mark as exception', async () => {
			// Mock Chrome 145+ with Split View
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				favIconUrl: '',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: 123, // IN Split View!
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false
			};

			// Mock chrome.tabs.query to return tabs in Split View with at least one active
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ ...mockTab, id: 100, active: false },
				{ ...mockTab, id: 101, active: true } // At least one active tab in Split View
			]);

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(true); // In ACTIVE Split View, should be exception
			expect(chrome.tabs.query).toHaveBeenCalledWith({
				windowId: 1,
				splitViewId: 123
			});
		});

		it('should allow suspension of tab NOT in Split View', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				favIconUrl: '',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: -1, // NOT in Split View
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false
			};

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(false); // Not in Split View, can be suspended
		});

		it('should allow suspension of tab in INACTIVE Split View', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				favIconUrl: '',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: 123, // IN Split View but...
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false
			};

			// Mock chrome.tabs.query to return tabs in Split View with NO active tabs
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ ...mockTab, id: 100, active: false },
				{ ...mockTab, id: 101, active: false } // No active tabs in Split View
			]);

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(false); // In INACTIVE Split View, can be suspended
			expect(chrome.tabs.query).toHaveBeenCalledWith({
				windowId: 1,
				splitViewId: 123
			});
		});
	});

	describe('Settings Control', () => {
		it('should respect ignoreSuspendSplitViewTabs setting when enabled', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			(global as any).settings.get = jest.fn((key: string) => {
				if (key === 'ignoreSuspendSplitViewTabs') return Promise.resolve(true);
				return Promise.resolve(false);
			});

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: 123, // In Split View
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false,
				favIconUrl: ''
			};

			// Mock chrome.tabs.query to return tabs in Split View with at least one active
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ ...mockTab, id: 100, active: false },
				{ ...mockTab, id: 101, active: true } // Active tab in Split View
			]);

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(true); // Setting enabled, tab protected
		});

		it('should allow suspension when ignoreSuspendSplitViewTabs is disabled', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			(global as any).settings.get = jest.fn((key: string) => {
				if (key === 'ignoreSuspendSplitViewTabs') return Promise.resolve(false);
				return Promise.resolve(false);
			});

			const mockTab: any = {
				id: 100,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				title: 'Example',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				splitViewId: 123, // In Split View but setting disabled
				status: 'complete',
				highlighted: false,
				incognito: false,
				selected: false,
				favIconUrl: ''
			};

			const isException = await tabManager.isExceptionTab(mockTab);
			expect(isException).toBe(false); // Setting disabled, can suspend
		});
	});

	describe('Multiple Split Views', () => {
		it('should protect tabs in different Split Views', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			// Ensure setting is enabled
			(global as any).settings.get = jest.fn((key: string) => {
				if (key === 'ignoreSuspendSplitViewTabs') return Promise.resolve(true);
				return Promise.resolve(false);
			});

			const splitView1Tab: any = {
				id: 100,
				splitViewId: 1,
				windowId: 1,
				index: 0,
				url: 'https://example.com',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				status: 'complete',
				title: '',
				highlighted: false,
				incognito: false,
				selected: false,
				favIconUrl: ''
			};

			const splitView2Tab: any = {
				id: 200,
				splitViewId: 2,
				windowId: 1,
				index: 1,
				url: 'https://example2.com',
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true,
				audible: false,
				groupId: -1,
				status: 'complete',
				title: '',
				highlighted: false,
				incognito: false,
				selected: false,
				favIconUrl: ''
			};

			// Mock chrome.tabs.query to return different results for different splitViewIds
			(chrome.tabs.query as jest.Mock).mockImplementation((queryInfo: any) => {
				if (queryInfo.splitViewId === 1) {
					// Split View 1 has active tab
					return Promise.resolve([
						{ ...splitView1Tab, id: 100, active: false },
						{ ...splitView1Tab, id: 102, active: true } // Active
					]);
				} else if (queryInfo.splitViewId === 2) {
					// Split View 2 has active tab
					return Promise.resolve([
						{ ...splitView2Tab, id: 200, active: true }, // Active
						{ ...splitView2Tab, id: 201, active: false }
					]);
				}
				return Promise.resolve([]);
			});

			const isException1 = await tabManager.isExceptionTab(splitView1Tab);
			const isException2 = await tabManager.isExceptionTab(splitView2Tab);

			expect(isException1).toBe(true); // Protected
			expect(isException2).toBe(true); // Protected
		});
	});

	describe('Discard Protection (CRITICAL)', () => {
		beforeEach(() => {
			// Clear module cache to reload TabParkController with real discardTab
			jest.resetModules();

			// Re-import TabParkController to get real discardTab function
			require('../../modules/TabParkController');
		});

		it('should NEVER discard tab in ACTIVE Split View (independent of setting)', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			// Mock chrome.tabs.get to return Split View tab
			(chrome.tabs.get as jest.Mock).mockResolvedValue({
				id: 100,
				splitViewId: 123, // IN Split View!
				url: 'https://example.com',
				windowId: 1,
				index: 0,
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true
			});

			// Mock chrome.tabs.query to return tabs in Split View with at least one active
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ id: 100, active: false, splitViewId: 123, windowId: 1 },
				{ id: 101, active: true, splitViewId: 123, windowId: 1 } // Active tab
			]);

			// Mock chrome.tabs.discard
			const mockDiscard = jest.fn();
			(chrome.tabs as any).discard = mockDiscard;

			// Try to discard tab in ACTIVE Split View
			await (global as any).discardTab(100);

			// CRITICAL: chrome.tabs.discard must NOT be called for ACTIVE Split View
			expect(mockDiscard).not.toHaveBeenCalled();
			expect(chrome.tabs.get).toHaveBeenCalledWith(100);
			expect(chrome.tabs.query).toHaveBeenCalledWith({
				windowId: 1,
				splitViewId: 123
			});
		});

		it('should allow discard for tabs NOT in Split View', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			// Mock chrome.tabs.get to return normal tab (not in Split View)
			(chrome.tabs.get as jest.Mock).mockResolvedValue({
				id: 100,
				splitViewId: -1, // NOT in Split View
				url: 'https://example.com',
				windowId: 1,
				index: 0,
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true
			});

			// Mock chrome.tabs.discard
			const mockDiscard = jest.fn();
			(chrome.tabs as any).discard = mockDiscard;

			// Try to discard normal tab
			await (global as any).discardTab(100);

			// Should call chrome.tabs.discard
			expect(mockDiscard).toHaveBeenCalledWith(100, expect.any(Function));
			expect(chrome.tabs.get).toHaveBeenCalledWith(100);
		});

		it('should allow discard for tabs in INACTIVE Split View', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			// Mock chrome.tabs.get to return tab in Split View
			(chrome.tabs.get as jest.Mock).mockResolvedValue({
				id: 100,
				splitViewId: 123, // IN Split View but...
				url: 'https://example.com',
				windowId: 1,
				index: 0,
				active: false,
				pinned: false,
				discarded: false,
				autoDiscardable: true
			});

			// Mock chrome.tabs.query to return tabs in Split View with NO active tabs
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ id: 100, active: false, splitViewId: 123, windowId: 1 },
				{ id: 101, active: false, splitViewId: 123, windowId: 1 } // No active tabs
			]);

			// Mock chrome.tabs.discard
			const mockDiscard = jest.fn();
			(chrome.tabs as any).discard = mockDiscard;

			// Try to discard tab in INACTIVE Split View
			await (global as any).discardTab(100);

			// Should allow discard for INACTIVE Split View
			expect(mockDiscard).toHaveBeenCalledWith(100, expect.any(Function));
			expect(chrome.tabs.get).toHaveBeenCalledWith(100);
			expect(chrome.tabs.query).toHaveBeenCalledWith({
				windowId: 1,
				splitViewId: 123
			});
		});

		it('should protect ACTIVE Split View tabs even when ignoreSuspendSplitViewTabs is disabled', async () => {
			(chrome.tabs as any).SPLIT_VIEW_ID_NONE = -1;

			// Disable the setting - discard protection should still work for ACTIVE Split Views
			(global as any).settings.get = jest.fn((key: string) => {
				if (key === 'ignoreSuspendSplitViewTabs') return Promise.resolve(false);
				return Promise.resolve(false);
			});

			// Mock chrome.tabs.get to return Split View tab
			(chrome.tabs.get as jest.Mock).mockResolvedValue({
				id: 100,
				splitViewId: 456, // IN Split View!
				url: 'https://example.com',
				windowId: 1,
				index: 0
			});

			// Mock chrome.tabs.query to return tabs in Split View with at least one active
			(chrome.tabs.query as jest.Mock).mockResolvedValue([
				{ id: 100, active: false, splitViewId: 456, windowId: 1 },
				{ id: 102, active: true, splitViewId: 456, windowId: 1 } // Active tab
			]);

			// Mock chrome.tabs.discard
			const mockDiscard = jest.fn();
			(chrome.tabs as any).discard = mockDiscard;

			// Try to discard
			await (global as any).discardTab(100);

			// CRITICAL: Must NOT discard ACTIVE Split View, even with setting disabled
			expect(mockDiscard).not.toHaveBeenCalled();
			expect(chrome.tabs.query).toHaveBeenCalledWith({
				windowId: 1,
				splitViewId: 456
			});
		});

		it('should handle old Chrome versions without splitViewId API', async () => {
			// Old Chrome without splitViewId
			(chrome.tabs.get as jest.Mock).mockResolvedValue({
				id: 100,
				// No splitViewId property
				url: 'https://example.com',
				windowId: 1,
				index: 0
			});

			// Mock chrome.tabs.discard
			const mockDiscard = jest.fn();
			(chrome.tabs as any).discard = mockDiscard;

			// Try to discard
			await (global as any).discardTab(100);

			// Should allow discard (backward compatibility)
			expect(mockDiscard).toHaveBeenCalledWith(100, expect.any(Function));
		});
	});
});
