/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

interface FormRestoreInfo {
	formData: string;
	url: string;
}

/**
 *
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PageStateRestoreController {
	private TIMEOUT = 7000;
	private PREFIX = 'f_t';
	private tabMap = {}; /* Key - actualTabId, Value - {timestamp: expectedTime, storedAsTabId: storedTabId, url: url} */

	constructor() {
		setInterval(this.cleanup, 60000);
	}

	/**
	 *
	 */
	async getFormRestoreDataAndRemove(actualTabId) {

		const targetMapEntry = this.getTargetMapEntry(actualTabId);
		if (targetMapEntry == null)
			return null;

		const key = this.PREFIX + targetMapEntry.storedAsTabId;
		const data = await LocalStore.get(key);
		void LocalStore.remove(key);

		return <FormRestoreInfo>{ formData: data, url: targetMapEntry.url };
	};

	/**
	 *
	 */
	getTargetMapEntry(actualTabId) {
		const tabMapEntry = this.tabMap[actualTabId];
		if (tabMapEntry != null) {
			if (this.isTabMapEntryOutdated(tabMapEntry))
				return null;
			else
				return tabMapEntry;
		}
	};

	/**
	 *
	 */
	async collectPageState(tabId) {

		let finished = false;
		return new Promise(resolve => {

			// eslint-disable-next-line @typescript-eslint/no-this-alias
			const self = this;
			chrome.tabs.sendMessage(tabId, { method: '[AutomaticTabCleaner:CollectPageState]' }, function(response/*{ formData, videoTime }*/) {
				if (debug)
					console.log('FData: ', response.formData);

				if (response.formData && Object.keys(response.formData).length !== 0 && response.formData.constructor === Object) {
					/* !TODO-v3: Make auto cleanup Important!
							Also cleanup old created keys in old localStorage - to free up user space
					 */
					void LocalStore.set(self.PREFIX + tabId, response.formData);
				}

				finished = true;
				resolve({ videoTime: response.videoTime });
			});

			setTimeout(() => {
				if (!finished) resolve({});
			}, 500);
		});
	};

	/**
	 *
	 */
	expectRestore(actualTabId, storedAsTabId, url) {
		if (actualTabId != null && storedAsTabId != null)
			this.tabMap[actualTabId] = { 'timestamp': new Date().getTime(), 'storedAsTabId': storedAsTabId, 'url': url };
	};

	/**
	 *
	 */
	cleanup() {
		for (const key in this.tabMap)
			if (this.tabMap.hasOwnProperty(key))
				if (this.isTabMapEntryOutdated(this.tabMap[key]))
					delete this.tabMap[key];
	};

	/**
	 *
	 */
	isTabMapEntryOutdated(tabMapEntry) {
		return Date.now() - tabMapEntry.timestamp > this.TIMEOUT;
	}
}

