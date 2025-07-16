
/*// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-require-imports
import onReplaced = chrome.tabs.onReplaced;*/

// @ts-ignore
addModuleToGlobal(require('../../modules/TabManager'));

describe('TabInfoManager test', () => {
	// Basic cases:

	// @ts-ignore
	global.HistoryOpenerController = class HistoryOpenerController {
		// Mock
		onNewTab(tab: chrome.tabs.Tab) {}
	};


	let onCreatedCallback: (tab: chrome.tabs.Tab) => void;
	let onReplacedCallback: (addedTabId: number, removedTabId: number) => void;
	let onUpdatedCallback: (tabId: number, changeInfo: TabChangeInfo, tab: chrome.tabs.Tab) => void;
	let onRemovedCallback: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
	let onActivatedCallback: (activeInfo: chrome.tabs.TabActiveInfo) => void;
	global.chrome = {
		...global.chrome,

		tabs: {
			// @ts-ignore
			onCreated: {
				addListener: (callback: (tab: chrome.tabs.Tab) => void) => {
					onCreatedCallback = callback;
				}
			},
			// @ts-ignore
			onReplaced: {
				addListener: (callback: (addedTabId: number, removedTabId: number) => void) => {
					onReplacedCallback = callback;
				}
			},
			// @ts-ignore
			onUpdated: {
				addListener: (callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => {
					onUpdatedCallback = callback;
				}
			},
			// @ts-ignore
			onRemoved: {
				addListener: (callback: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void) => {
					onRemovedCallback = callback;
				}
			},
			// @ts-ignore
			onActivated: {
				addListener: (callback: (activeInfo: chrome.tabs.TabActiveInfo) => void) => {
					onActivatedCallback = callback;
				}
			}
		}
	};

	/*
	chrome.tabs.onCreated.addListener(tab: chrome.tabs.Tab)
	chrome.tabs.onReplaced.addListener(addedTabId: number, removedTabId: number)
	chrome.tabs.onUpdated.addListener(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab)
	chrome.tabs.onRemoved.addListener(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo)
	chrome.tabs.onActivated.addListener(activeInfo: chrome.tabs.TabActiveInfo)
	 */

	// @ts-ignore
	// eslint-disable-next-line @typescript-eslint/no-unused-vars


	it('tabInfo should collected', async () => {


		const tabManager = new TabManager();

		let baseTab: chrome.tabs.Tab = {
			id: 1,
			active: true,
			windowId: 0,
			index: 1,
			url: 'http://site.com/path',
			discarded: false,
			autoDiscardable: true,
			groupId: 0,
			highlighted: false,
			incognito: false,
			pinned: false,
			selected: false
		};

		onCreatedCallback(baseTab);

		onActivatedCallback({tabId: 1, windowId: 0});

		onCreatedCallback({
			...baseTab,
			id: 2,
			active: false,
		});

		onReplacedCallback(1, 2);
		onUpdatedCallback(1, {}, baseTab);
		onRemovedCallback(1, {windowId: 0, isWindowClosing: false});


		await sleep(100);
	});
	it('tabInfo should collected correctly for suspended tabs', async () => {
		// TODO: .....
	});
	it('tabInfo should cleanup after correct delay', async () => {
		// TODO: .....
	});

	// Corner cases:
	it('tabInfo should stay in normal state', async () => {
		// TODO: .....
	});

	it('tabInfo should stay after discarded any times', async () => {
		// TODO: .....
	});

	it('tabInfo should stay after browser restart', async () => {
		// TODO: .....
	});
	it('tabInfo should stay if tab.id != tabId in url', async () => {
		// TODO: .....
	});
});