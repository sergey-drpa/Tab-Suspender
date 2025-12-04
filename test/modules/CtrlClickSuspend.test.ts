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
(global as any).nextTabShouldBeSuspended = false;
(global as any).NEXT_TAB_SUSPEND_TTL = 3000;

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
	get: jest.fn().mockImplementation((key: string) => {
		if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
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

describe('Ctrl/Cmd+Click Suspend Functionality', () => {
	let tabManager: any;
	let TabManager: any;
	let TabInfo: any;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.resetModules();

		// Clear global variables
		(global as any).getScreenCache = null;
		(global as any).nextTabShouldBeSuspended = false;

		// Try to mock Date.now if not using fake timers
		try {
			((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);
		} catch (e) {
			// Ignore if Date.now mock is not available (e.g., when using fake timers)
		}

		// Re-import modules
		const TabInfoModule = require('../../modules/model/TabInfo');
		TabInfo = TabInfoModule.TabInfo;

		// Make TabInfo available globally
		(global as any).TabInfo = TabInfo;

		const TabManagerModule = require('../../modules/TabManager');
		TabManager = TabManagerModule.TabManager;

		tabManager = new TabManager();
	});

	afterEach(() => {
		jest.clearAllTimers();
	});

	test('should mark tab for suspension when Ctrl/Cmd+Click is detected and setting is enabled', async () => {
		// Set the flag that indicates Ctrl/Cmd+Click
		(global as any).nextTabShouldBeSuspended = true;

		// Mock settings.get to return true for suspendOnCtrlClick
		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		// Simulate tab creation (background tab)
		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			pendingUrl: 'https://example.com',
			active: false,
			discarded: false,
			autoDiscardable: false
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// Check that the tab was marked for suspension
		const tabInfo = tabManager.getTabInfoById(tab.id);
		expect(tabInfo.markedForLoadSuspended).toBe(true);
		expect(tabInfo.originalUrlBeforeSuspend).toBe('https://example.com');
		expect((global as any).nextTabShouldBeSuspended).toBe(false);
	});

	test('should NOT mark tab for suspension when setting is disabled', async () => {
		// Set the flag that indicates Ctrl/Cmd+Click
		(global as any).nextTabShouldBeSuspended = true;

		// Mock settings.get to return false for suspendOnCtrlClick
		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(false);
			return Promise.resolve(false);
		});

		// Simulate tab creation (background tab)
		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			pendingUrl: 'https://example.com',
			active: false,
			discarded: false,
			autoDiscardable: false
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// Check that the tab was NOT marked for suspension
		const tabInfo = tabManager.getTabInfoById(tab.id);
		expect(tabInfo.markedForLoadSuspended).toBe(false);
		expect((global as any).nextTabShouldBeSuspended).toBe(false);
	});

	test('should NOT mark active tab for suspension even with Ctrl/Cmd+Click', async () => {
		// Set the flag that indicates Ctrl/Cmd+Click
		(global as any).nextTabShouldBeSuspended = true;

		// Mock settings.get to return true for suspendOnCtrlClick
		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		// Simulate tab creation (ACTIVE tab)
		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			pendingUrl: 'https://example.com',
			active: true, // Active tab
			discarded: false,
			autoDiscardable: false
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// Check that the tab was NOT marked for suspension (because it's active)
		const tabInfo = tabManager.getTabInfoById(tab.id);
		expect(tabInfo.markedForLoadSuspended).toBe(false);
	});

	test('should suspend tab with favicon when page is complete', async () => {
		jest.useFakeTimers();

		// First, mark a tab for suspension
		(global as any).nextTabShouldBeSuspended = true;

		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			pendingUrl: 'https://example.com',
			active: false,
			discarded: false,
			autoDiscardable: false,
			status: 'loading'
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// Verify tab is marked for suspension
		let tabInfo = tabManager.getTabInfoById(tab.id);
		expect(tabInfo.markedForLoadSuspended).toBe(true);

		// Mock chrome.tabs.get to return tab with favicon
		(chrome.tabs.get as jest.Mock).mockResolvedValue({
			...tab,
			id: 1,
			title: 'Example Page',
			favIconUrl: 'https://example.com/favicon.ico',
			status: 'complete'
		});

		// Mock chrome.tabs.update
		(chrome.tabs.update as jest.Mock).mockResolvedValue(undefined);

		// Now trigger onUpdated with status=complete
		const onUpdatedListener = (chrome.tabs.onUpdated as any).addListener.mock.calls[0][0];
		await onUpdatedListener(tab.id, { status: 'complete' }, { ...tab, status: 'complete' });

		// Fast-forward timers to trigger polling
		await jest.advanceTimersByTimeAsync(200);

		// Check that chrome.tabs.get was called
		expect(chrome.tabs.get).toHaveBeenCalledWith(tab.id);

		// Wait for promise to resolve
		await Promise.resolve();

		// Check that chrome.tabs.update was called with park URL
		expect(chrome.tabs.update).toHaveBeenCalledWith(
			tab.id,
			expect.objectContaining({
				url: expect.stringContaining('park.html')
			})
		);

		// Verify the URL contains title and favicon
		const updateCall = (chrome.tabs.update as jest.Mock).mock.calls[0];
		const parkUrl = updateCall[1].url;
		expect(parkUrl).toContain('title=Example%20Page');
		expect(parkUrl).toContain('icon=https%3A%2F%2Fexample.com%2Ffavicon.ico');
		expect(parkUrl).toContain('url=https%3A%2F%2Fexample.com');

		jest.useRealTimers();
	});

	test('should retry polling for favicon if not available immediately', async () => {
		jest.useFakeTimers();

		// First, mark a tab for suspension
		(global as any).nextTabShouldBeSuspended = true;

		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			pendingUrl: 'https://example.com',
			active: false,
			discarded: false,
			autoDiscardable: false,
			status: 'loading'
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// Mock chrome.tabs.get to return tab WITHOUT favicon first, then WITH favicon
		let callCount = 0;
		(chrome.tabs.get as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// First call - no favicon
				return Promise.resolve({
					...tab,
					id: 1,
					title: 'Example Page',
					favIconUrl: undefined,
					status: 'complete'
				});
			} else {
				// Second call - with favicon
				return Promise.resolve({
					...tab,
					id: 1,
					title: 'Example Page',
					favIconUrl: 'https://example.com/favicon.ico',
					status: 'complete'
				});
			}
		});

		// Mock chrome.tabs.update
		(chrome.tabs.update as jest.Mock).mockResolvedValue(undefined);

		// Now trigger onUpdated with status=complete
		const onUpdatedListener = (chrome.tabs.onUpdated as any).addListener.mock.calls[0][0];
		await onUpdatedListener(tab.id, { status: 'complete' }, { ...tab, status: 'complete' });

		// Fast-forward first polling attempt (no favicon)
		await jest.advanceTimersByTimeAsync(200);
		await Promise.resolve();

		// Verify first call was made
		expect(chrome.tabs.get).toHaveBeenCalledTimes(1);

		// chrome.tabs.update should NOT have been called yet (no favicon)
		expect(chrome.tabs.update).not.toHaveBeenCalled();

		// Fast-forward second polling attempt (with favicon)
		await jest.advanceTimersByTimeAsync(200);
		await Promise.resolve();

		// Verify second call was made
		expect(chrome.tabs.get).toHaveBeenCalledTimes(2);

		// Now chrome.tabs.update should have been called
		expect(chrome.tabs.update).toHaveBeenCalledWith(
			tab.id,
			expect.objectContaining({
				url: expect.stringContaining('park.html')
			})
		);

		// Verify the URL contains favicon
		const updateCall = (chrome.tabs.update as jest.Mock).mock.calls[0];
		const parkUrl = updateCall[1].url;
		expect(parkUrl).toContain('icon=https%3A%2F%2Fexample.com%2Ffavicon.ico');

		jest.useRealTimers();
	});

	test('should mark tab for suspension even if URL is temporarily undefined, but wait for valid URL', async () => {
		jest.useFakeTimers();

		// First, set flag for suspension
		(global as any).nextTabShouldBeSuspended = true;

		(global as any).settings.get = jest.fn().mockImplementation((key: string) => {
			if (key === 'suspendOnCtrlClick') return Promise.resolve(true);
			return Promise.resolve(false);
		});

		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: undefined, // URL is undefined at creation - temporary state
			pendingUrl: undefined,
			active: false,
			discarded: false,
			autoDiscardable: false,
			status: 'loading'
		};

		// Trigger the onCreated event
		const onCreatedListener = (chrome.tabs.onCreated as any).addListener.mock.calls[0][0];
		await onCreatedListener(tab);

		// NEW BEHAVIOR: Tab IS marked for suspension even with undefined URL
		// We wait for the URL to become valid in onUpdated
		let tabInfo = tabManager.getTabInfoById(tab.id);
		expect(tabInfo.markedForLoadSuspended).toBe(true);
		// originalUrlBeforeSuspend is null because URL was undefined
		// We'll use updatedTab.url in pollForFavicon
		expect(tabInfo.originalUrlBeforeSuspend).toBeNull();

		jest.useRealTimers();
	});

	test('should NOT suspend tab if URL becomes invalid during polling', async () => {
		jest.useFakeTimers();

		// Create tab info manually
		const tab = {
			id: 1,
			windowId: 1,
			index: 0,
			url: 'https://example.com',
			active: false,
			discarded: false,
			autoDiscardable: false,
			status: 'loading'
		};

		const tabInfo = tabManager.createNewTabInfo(tab);
		tabInfo.markedForLoadSuspended = true;
		tabInfo.originalUrlBeforeSuspend = null; // Explicitly set to null to simulate invalid state

		// Mock chrome.tabs.get to return tab with chrome-extension URL (invalid)
		(chrome.tabs.get as jest.Mock).mockResolvedValue({
			...tab,
			id: 1,
			title: 'Example Page',
			favIconUrl: 'https://example.com/favicon.ico',
			url: 'chrome-extension://test/park.html', // Invalid URL
			status: 'complete'
		});

		// Mock chrome.tabs.update
		(chrome.tabs.update as jest.Mock).mockResolvedValue(undefined);

		// Trigger onUpdated with status=complete
		const onUpdatedListener = (chrome.tabs.onUpdated as any).addListener.mock.calls[0][0];
		await onUpdatedListener(tab.id, { status: 'complete' }, { ...tab, status: 'complete' });

		// Fast-forward timers
		await jest.advanceTimersByTimeAsync(200);
		await Promise.resolve();

		// Verify chrome.tabs.update was NOT called (tab should not be parked with invalid URL)
		expect(chrome.tabs.update).not.toHaveBeenCalled();

		// Verify flags were cleared
		expect(tabInfo.markedForLoadSuspended).toBe(false);
		expect(tabInfo.originalUrlBeforeSuspend).toBeNull();

		jest.useRealTimers();
	});
});
