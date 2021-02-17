/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 *
 */
function HistoryOpenerController() {
	'use strict';

	this.historyPages = {};
	this.parkUrl = chrome.extension.getURL('park.html');
}

/**
 *
 */
HistoryOpenerController.prototype.collectInitialTabState = function(tab) {
	if (this.isHistory(tab.url))
		this.historyPages[tab.id] = true;
};

/**
 *
 */
HistoryOpenerController.prototype.onTabUpdate = function(tabId, changeInfo) {
	if (changeInfo.url != null)
		if (this.isHistory(changeInfo.url))
			this.historyPages[tabId] = true;
		else if (this.historyPages[tabId] != null) {
			if (changeInfo.url.indexOf(this.parkUrl) == 0)
				this.markTabFromHistory(tabId, changeInfo.url);

			delete this.historyPages[tabId];
		}

};

/**
 *
 */
HistoryOpenerController.prototype.markTabFromHistory = function(tabId, url) {
	chrome.tabs.update(tabId, { url: url + '#fromHistory' });
};

/**
 *
 */
HistoryOpenerController.prototype.onNewTab = function(tab) {
	let self = this;
	if (tab.openerTabId != null)
		chrome.tabs.get(tab.openerTabId, function(oTab) {
			if (self.isHistory(oTab.url))
				self.markTabFromHistory(tab.id, tab.url || tab.pendingUrl);
		});
};

/**
 *
 */
HistoryOpenerController.prototype.onRemoveTab = function(tabId) {
	if (this.historyPages[tabId] != null)
		delete this.historyPages[tabId];
};

/**
 *
 */
HistoryOpenerController.prototype.isHistory = function(tabUrl) {
	return tabUrl.indexOf('chrome://history/') == 0;
};
