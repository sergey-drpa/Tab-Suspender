
/*// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-require-imports
import onReplaced = chrome.tabs.onReplaced;*/

// @ts-ignore
import UpdateProperties = chrome.tabs.UpdateProperties;

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-require-imports
addModuleToGlobal(require('../../modules/TabManager'));
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-require-imports
addModuleToGlobal(require('../../modules/model/TabInfo'));

describe('TabInfoManager test', () => {
	// Basic cases:

	// @ts-ignore
	global.HistoryOpenerController = class HistoryOpenerController {
		// Mock
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
			/* Events */
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
			},
			/* Methods */
			// @ts-ignore
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			update: async (tabId: number, updateProperties: UpdateProperties) => {},
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


	it('tabInfo should collected, and correctly replaced when tab.onReplaced()', async () => {


		const tabManager = new TabManager();
		const settings = new SettingsStore('test', DEFAULT_SETTINGS);
		// @ts-ignore
		global.settings = settings;

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

		// TODO:... Checks

		await sleep(500);

		onActivatedCallback({tabId: 1, windowId: 0});

		// TODO:... Checks

		await sleep(500);

		onCreatedCallback({
			...baseTab,
			id: 2,
			url: 'http://site.com/path2',
			active: false,
		});

		// TODO:... Checks

		await sleep(500);

		// @ts-ignore
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		global.chrome.tabs.get = (tabId: number, callback: (tab: Tab) => void) => {
			return {
				id: 1,
				url: parkUrl+ "?tabId=1"
			};
		}

		onReplacedCallback(1, 2);

		await sleep(500);

		const tabInfosRaw = tabManager.getTabInfosCopy();
		//const tabInfos = tabInfosCopy.map((tabInfoRaw: TabInfo) => TabInfo.fromObject(tabInfoRaw));

		expect(Object.keys(tabInfosRaw).length).toBe(2);

		const tabInfo1 = TabInfo.fromObject(tabInfosRaw[1]);
		expect(tabInfo1.id).toBe(1);
		expect(tabInfo1.oldRefId).toBe(2);
		expect(tabInfo1.newRefId).toBe(1);
		expect(tabInfo1.lstCapUrl).toBe("http://site.com/path2");

		const tabInfo2 = TabInfo.fromObject(tabInfosRaw[2]);
		expect(tabInfo2.id).toBe(1);
		expect(tabInfo2.oldRefId).toBe(2);
		expect(tabInfo2.newRefId).toBe(1);
		expect(tabInfo2.lstCapUrl).toBe("http://site.com/path2");


		// TODO:
		//onUpdatedCallback(1, {}, baseTab);
		//onRemovedCallback(1, {windowId: 0, isWindowClosing: false});


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