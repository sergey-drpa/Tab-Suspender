/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/*
 * TEMPORARY SOLUTION: TODO: Refactor with Global variable hash!!!
 */
let lastIcon = '';

/**
 *
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class BrowserActionControl {
	private readonly extensionTitle: string;
	private settings: SettingsStore;
	private readonly whiteList: WhiteList;
	private readonly globalMenuIdMap: { [key: string | number]: string | number };
	private readonly pauseTics: number;

	private readonly expectedExceptions = 'RegExp:No tab with id: \\d{1,5}\\.';

	constructor(settings: SettingsStore,
							whiteList: WhiteList,
							globalMenuIdMap: { [key: string | number]: string | number },
							pauseTics: number
	) {
		this.extensionTitle = 'Tab Suspender';
		this.settings = settings;
		this.whiteList = whiteList;
		this.globalMenuIdMap = globalMenuIdMap;
		this.pauseTics = pauseTics;
	}

	/**
	 *
	 */
	async updateStatus(tab) {

		let computedIcon;
		let isIconSet = false;

		if (await this.settings.get('active')) {
			computedIcon = 'img/icon16.png';
		} else {
			computedIcon = 'img/icon16_off.png';
			isIconSet = true;
		}

		if (!isIconSet) {
			if (this.pauseTics > 0) {
				computedIcon = 'img/icon16_paused.png';
				isIconSet = true;
			}
			if (this.pauseTics <= 0)
				computedIcon = 'img/icon16.png';
		}

		let ignoredTab = false;
		let whitelistedTab = false;
		if (this.whiteList != null && this.globalMenuIdMap != null) {
			ignoredTab = ignoreList.isTabInIgnoreTabList(tab.id);
			if (ignoredTab) {
				chrome.contextMenus.update(this.globalMenuIdMap['ignore-current-tab'], {
					checked: true,
					title: 'Already Ignored (For current session only)'
				});
			} else {
				chrome.contextMenus.update(this.globalMenuIdMap['ignore-current-tab'], { checked: false });
			}

			whitelistedTab = (this.whiteList.isURIException(tab.url) || this.whiteList.isURIException(parseUrlParam(tab.url, 'url')));
			if (whitelistedTab) {
				this.setBrowserActionTitle(tab.id, this.extensionTitle + ': Page is in Whitelist');

				chrome.contextMenus.update(this.globalMenuIdMap['add_to_white_list'], {
					checked: true,
					title: 'Already in Whitelist (Click to remove)'
				});
			} else {
				this.setBrowserActionTitle(tab.id, this.extensionTitle);

				chrome.contextMenus.update(this.globalMenuIdMap['add_to_white_list'], {
					checked: false,
					title: 'Add to Whitelist...'
				});
			}

			if (!isIconSet) {
				if (ignoredTab)
					computedIcon = 'img/icon16_green_minus.png';
				else if (whitelistedTab) {
					computedIcon = 'img/icon16_green.png';
				} else
					computedIcon = 'img/icon16.png';
			}
		}
		if (computedIcon != lastIcon) {
			void chrome.action.setIcon({ 'path': computedIcon });
			lastIcon = computedIcon;
		}
	}

	/**
	 *
	 */
	synchronizeActiveTabs() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		chrome.tabs.query({ active: true }, function(tabs) {
			for (const i in tabs)
				if (tabs.hasOwnProperty(i))
					void self.updateStatus(tabs[i]);
		});
	}

	/**
	 *
	 */
	setBrowserActionTitle(tabId, title) {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		chrome.action.getTitle({ tabId: tabId }, function(actualTitle) {
			if (!hasLastError(self.expectedExceptions))
				if (actualTitle != title)
					chrome.action.setTitle({ tabId: tabId, title: title }, function() {
						hasLastError(self.expectedExceptions);
					});
		});
	}
}
