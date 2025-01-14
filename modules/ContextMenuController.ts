
interface MenuInfo extends  chrome.contextMenus.CreateProperties {
	title?: string;
	onclick?: (info, tab) => void;
	documentUrlPatterns?: string[];
	_command?: string;
	_width?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ContextMenuController {

	private tabManager: TabManager;
	
	constructor(tabManager: TabManager) {
		this.tabManager = tabManager;
	}


	private readonly TOP_MENU_ID = 'tab-suspender';

	private menus: MenuInfo[] = null;
	public static menuIdMap: { [key: string | number]: string | number } = null;

	create(extUrl: string) {
		if (ContextMenuController.menuIdMap == null) {

			this.menus = this.getMenusInfo(extUrl);

			chrome.commands.getAll(function(commands) {
				if (debug)
					console.log('Commands:', commands);

				ContextMenuController.menuIdMap = contextMenuController.createMenu(commands);
			});
		} else
			console.log('ContextMenu already initialized');
	}

	createMenu(commands: chrome.commands.Command[]): { [key: string | number]: string | number } {

		const idsMap: { [key: string | number]: string | number } = {};
		const commandMap = {};
		// TODO-v4:
		// let menuSpaceWidth = getTextWidth('a a') - getTextWidth('aa');
		const menuSpaceWidth = 5;
		let maxMenuLen = 0;

		for (const j in this.menus) {
			// TODO-v4:
			if (true/*this.menus[j].type == null || this.menus[j].type !== 'hidden'*/) {
				// TODO-v4:
				// this.menus[j]._width = getTextWidth(this.menus[j].title);
				this.menus[j]._width = 5;
				if (this.menus[j]._width > maxMenuLen)
					maxMenuLen = this.menus[j]._width;
			}
		}

		const constantSpaces = maxMenuLen * 0.33;

		// eslint-disable-next-line no-redeclare
		for (const j in this.menus) {
			const missingSpaces = (maxMenuLen - this.menus[j]._width) / menuSpaceWidth;

			for (let k = 0; k < missingSpaces; k++)
				this.menus[j].title += ' ';

			// eslint-disable-next-line no-redeclare
			for (let k = 0; k < constantSpaces / menuSpaceWidth; k++)
				this.menus[j].title += ' ';

			if (this.menus[j]._command != null) {
				for (const i in commands) {
					if (commands[i] == null || commands[i].name == null)
						continue;

					if (commands[i].name == this.menus[j]._command)
						this.menus[j].title += commands[i].shortcut;
				}

				commandMap[this.menus[j]._command] = this.menus[j].onclick;

				delete this.menus[j]['_command'];
			}

			if (this.menus[j]._width != null)
				delete this.menus[j]['_width'];

			// TODO-v4:
			if (true/*this.menus[j].type == null || this.menus[j].type !== 'hidden'*/) {
				const id = chrome.contextMenus.create({
					...this.menus[j] as chrome.contextMenus.CreateProperties,
					onclick: undefined
				});

				if (this.menus[j].id != null)
					idsMap[this.menus[j].id] = id;
			}
		}

		chrome.commands.onCommand.addListener(function(command) {
			if (debug)
				console.log('Command:', command);

			if (commandMap[command] != null) {
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					if (tabs.length > 0 && tabs[0] != null)
						commandMap[command](null, tabs[0]);
				});
			}
		});

		this.bindOnClick();

		return idsMap;
	}

	private bindOnClick() {
		chrome.contextMenus.onClicked.addListener(
			(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
				const onclick = this.menus.find(menu => menu.id == info.menuItemId)
					?.onclick;
				if (onclick != null) {
					onclick(info, tab);
				}
			}
		);
	}

	/*** Data ***/
	getMenusInfo(extUrl: string): MenuInfo[] {

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		return [
			{
				id: this.TOP_MENU_ID,
				title: 'Tab Suspender',
				contexts: ['all'],
				onclick: null
			},
			{
				title: 'Suspend Tab',
				contexts: ['all'],
				onclick: function(info, tab) {
					parkTab(tab, tab.id);
				},
				parentId: this.TOP_MENU_ID,
				documentUrlPatterns: ['http://*/*', 'https://*/*'],
				id: 'suspend-current',
				_command: 'suspend-current'
			},
			{
				id: 'separator-1',
				type: 'separator',
				title: 'Whitelist separator',
				contexts: ['all'],
				parentId: this.TOP_MENU_ID,
				documentUrlPatterns: ['http://*/*', 'https://*/*']
			},
			{
				type: 'checkbox',
				id: 'add_to_white_list',
				title: 'Add to Whitelist...',
				contexts: ['all'],
				onclick: function(info, tab) {
					if (info == null || info.checked) {
						if (!whiteList.isURIException(tab.url)) {
							chrome.tabs.sendMessage(tab.id, { method: '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]' });
							new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
						}
					} else
						whiteList.removeUrlFromWhitelist(tab.url);
				},
				parentId: this.TOP_MENU_ID,
				//documentUrlPatterns: ['http://*/*', 'https://*/*', `${rootExtensionUri}*/*`],
				_command: 'add-to-white-list'
			},
			/* TODO-v3:
			{
				type: 'hidden',
				id: 'remove_from_white_list',
				title: 'Remove from Whitelist',
				contexts: ['all'],
				onclick: function(info, tab) {
					whiteList.removeUrlFromWhitelist(tab.url);
				},
				parentId: this.TOP_MENU_ID,
				documentUrlPatterns: ['http://!*!/!*', 'https://!*!/!*'],
				_command: 'remove-from-white-list'
			},*/
			{
				id: 'separator-2',
				type: 'separator',
				title: 'Whitelist separator',
				contexts: ['all'],
				parentId: this.TOP_MENU_ID
				//documentUrlPatterns: ['http://*/*', 'https://*/*']
			},
			{
				id: 'suspend-all',
				title: 'Suspend all',
				contexts: ['all'],
				onclick: function() {
					parkTabs(null);
				},
				parentId: this.TOP_MENU_ID
			},
			{
				title: 'Suspend all Other',
				contexts: ['all'],
				onclick: function(info, tab) {
					parkTabs(tab);
				},
				parentId: this.TOP_MENU_ID,
				documentUrlPatterns: ['http://*/*', 'https://*/*'],
				id: 'suspend-all-other',
				_command: 'suspend-all-other'
			},
			{
				title: 'Suspend Window',
				contexts: ['all'],
				onclick: function(info, tab) {
					parkTabs(tab, tab.windowId);
				},
				parentId: this.TOP_MENU_ID,
				id: 'suspend-all-window',
				_command: 'suspend-all-window'
			},
			{
				title: 'Unsuspend all Tabs',
				contexts: ['all'],
				onclick: function() {
					unsuspendTabs();
				},
				parentId: this.TOP_MENU_ID,
				id: 'unsuspend-all-tabs',
				_command: 'unsuspend-all-tabs'
			},
			{
				title: 'Unsuspend Window',
				contexts: ['all'],
				onclick: function(info, tab) {
					unsuspendTabs(tab.windowId);
				},
				parentId: this.TOP_MENU_ID,
				id: 'unsuspend-current-window',
				_command: 'unsuspend-current-window'
			},
			{
				title: 'Unsuspend Current Tab',
				contexts: ['all'],
				onclick: function(info, tab) {
					self.tabManager.unsuspendTab(tab);
				},
				parentId: this.TOP_MENU_ID,
				id: 'unsuspend-current-tab',
				_command: 'unsuspend-current-tab',
				documentUrlPatterns: [extUrl + '**']
			},
			{
				id: 'separator-3',
				type: 'separator',
				title: 'Whitelist separator',
				contexts: ['all'],
				parentId: this.TOP_MENU_ID,
				documentUrlPatterns: ['http://*/*', 'https://*/*']
			},
			{
				type: 'checkbox',
				title: 'Ignore Current Tab',
				contexts: ['all'],
				onclick: function(info, tab) {
					if (info == null || info.checked) {
						ignoreList.addToIgnoreTabList(tab.id);
					} else {
						ignoreList.removeFromIgnoreTabList(tab.id);
					}
				},
				parentId: this.TOP_MENU_ID,
				id: 'ignore-current-tab',
				_command: 'ignore-current-tab',
				documentUrlPatterns: ['http://*/*', 'https://*/*']
			},
			/* TODO-v3:
			{
				type: 'hidden',
				contexts: ['all'],
				title: 'Suspend or Unsuspend Current Tab (in one HotKey)',
				parentId: this.TOP_MENU_ID,
				onclick: function(info, tab) {
					if (!tab.url.startsWith(extUrl)) {
						parkTab(tab, tab.id);
					} else {
						unsuspendTab(tab);
					}
				},
				_command: 'suspend-or-unsuspend-current-tab'
			}*/,
			{
				id: 'separator-4',
				type: 'separator',
				title: 'Whitelist separator',
				contexts: ['all'],
				parentId: this.TOP_MENU_ID
				//documentUrlPatterns: ['http://*/*', 'https://*/*']
			},
			{
				id: 'change-hotkeys',
				title: 'Change Hotkeys...',
				contexts: ['all'],
				onclick: function() {
					chrome.tabs.create({ 'url': 'chrome://extensions/configureCommands' }, function() {
					});
				},
				parentId: this.TOP_MENU_ID
			},
			{
				id: 'suspend-history',
				title: 'Suspended History...',
				contexts: ['all'],
				onclick: openSuspendedHistory,
				parentId: this.TOP_MENU_ID
			},
			{
				id: 'closed-tabs-history',
				title: 'Closed Tabs History...',
				contexts: ['all'],
				onclick: openClosedHistory,
				parentId: this.TOP_MENU_ID
			},
			{
				id: 'settings',
				title: 'Settings...',
				contexts: ['all'],
				onclick: function() {
					SettingsPageController.openSettings();
				},
				parentId: this.TOP_MENU_ID
			}
		];
	}

	// TODO-v3:
	getTextWidth(text) {
		const span = document.createElement('span');
		span.style.whiteSpace = 'nowrap';
		span.style.fontFamily = 'initial';
		span.style.fontSize = 'initial';
		span.textContent = text;
		document.getElementsByTagName('body')[0].appendChild(span);
		const offsetWidth = span.offsetWidth;
		span.remove();
		return offsetWidth;
	}
}