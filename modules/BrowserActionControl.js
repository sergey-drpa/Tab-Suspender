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
// eslint-disable-next-line no-redeclare
function BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics) {
	'use strict';

	this.extensionTitle = 'Tab Suspender';
	this.settings = settings;
	this.whiteList = whiteList;
	this.globalMenuIdMap = globalMenuIdMap;
	this.pauseTics = pauseTics;
}

/**
 *
 */
BrowserActionControl.prototype.updateStatus = function(tab) {
	'use strict';

	let computedIcon;
	let isIconSet = false;

	if (this.settings.get('active')) {
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
		if (ignoredTab == window.isTabInIgnoreTabList(tab.id)) {
			chrome.contextMenus.update(this.globalMenuIdMap['ignore-current-tab'], {
				checked: true,
				title: 'Already Ignored (For current session only)'
			});
		} else {
			chrome.contextMenus.update(this.globalMenuIdMap['ignore-current-tab'], { checked: false });
		}

		if (whitelistedTab = (this.whiteList.isURIException(tab.url) || this.whiteList.isURIException(parseUrlParam(tab.url, 'url')))) {
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
		chrome.browserAction.setIcon({ 'path': computedIcon });
		lastIcon = computedIcon;
	}
};

/**
 *
 */
BrowserActionControl.prototype.synchronizeActiveTabs = function() {
	'use strict';

	let self = this;
	chrome.tabs.query({ active: true }, function(tabs) {
		for (let i in tabs)
			if (tabs.hasOwnProperty(i))
				self.updateStatus(tabs[i]);
	});
};

/**
 *
 */
BrowserActionControl.prototype.setBrowserActionTitle = function(tabId, title) {
	'use strict';

	let expectedExceptions = 'RegExp:No tab with id: \\d{1,5}\\.';
	chrome.browserAction.getTitle({ tabId: tabId }, function(actualTitle) {
		if (!hasLastError(expectedExceptions))
			if (actualTitle != title)
				chrome.browserAction.setTitle({ tabId: tabId, title: title }, function() {
					hasLastError(expectedExceptions);
				});
	});
};
