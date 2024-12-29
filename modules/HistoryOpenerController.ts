/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import TabChangeInfo = chrome.tabs.TabChangeInfo;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class HistoryOpenerController {
	private historyPages = {};

	collectInitialTabState(tab: chrome.tabs.Tab) {
		if (this.isHistory(tab.url))
			this.historyPages[tab.id] = true;
	};

	onTabUpdate(tabId: number, changeInfo: TabChangeInfo) {
		if (changeInfo.url != null)
			if (this.isHistory(changeInfo.url))
				this.historyPages[tabId] = true;
			else if (this.historyPages[tabId] != null) {
				if (changeInfo.url.indexOf(parkUrl) == 0)
					this.markTabFromHistory(tabId, changeInfo.url);

				delete this.historyPages[tabId];
			}
	};

	markTabFromHistory(tabId, url) {
		chrome.tabs.update(tabId, { url: url + '#fromHistory' })
			.catch(console.error);
	};

	onNewTab(tab: chrome.tabs.Tab) {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		if (tab.openerTabId != null)
			chrome.tabs.get(tab.openerTabId, function(oTab) {
				if (self.isHistory(oTab.url))
					self.markTabFromHistory(tab.id, tab.url || tab.pendingUrl);
			});
	};

	onRemoveTab(tabId: number) {
		if (this.historyPages[tabId] != null)
			delete this.historyPages[tabId];
	};

	isHistory(tabUrl) {
		return tabUrl.indexOf('chrome://history/') == 0;
	}

	reloadHistoryPage() {
		chrome.runtime.getContexts({ documentUrls: [historyPageUrl] }, (contexts: chrome.runtime.ExtensionContext[]) => {
			for (let i = 0; i <= contexts.length; i++) {
				if (contexts[i]) {
					chrome.tabs.reload(contexts[i].tabId, {}).catch(console.error);
				}
			}
		});
	}
}
