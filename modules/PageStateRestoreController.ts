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
	private tabMap = {}; /* Key - actualTabId, Value - {timestamp: expectedTime, storedAsTabId: storedTabId, url: url} */

	constructor() {
		setInterval(this.cleanup, 60000);
	}

	/**
	 *
	 */
	async getFormRestoreDataAndRemove(actualTabId) {

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		const targetMapEntry = this.getTargetMapEntry(actualTabId);
		if (targetMapEntry == null)
			return null;

		//void LocalStore.remove(key);

		const storedTabIdInt = parseInt(targetMapEntry.storedAsTabId);

		return new Promise<FormRestoreInfo>((resolve, reject) => {
			database.queryIndex(
				{
					IDB:
						{
							// @ts-ignore
							table: FD_DB_NAME,
						},
					params: [storedTabIdInt]
				},
				function(fields) {
					if (fields == null) {
						reject();
					}

					if (debugScreenCache)
						console.log('getScreen result: ', Date.now());

					void self.deleteDataRecord(actualTabId);

					resolve({ formData: fields.data, url: targetMapEntry.url });
				}
			);
		});
	};

	async deleteDataRecord(tabId: number) {
		database.executeDelete({
			IDB:
				{
					// @ts-ignore
					table: FD_DB_NAME,
					params: [tabId]
				}
		});
	}

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
	async collectPageState(tabId: number) {

		let finished = false;
		return new Promise(resolve => {

			chrome.tabs.sendMessage(tabId, { method: '[AutomaticTabCleaner:CollectPageState]' }, function(response/*{ formData, videoTime }*/) {
				if (debug)
					console.log('FData: ', response.formData);

				if (response.formData && Object.keys(response.formData).length !== 0 && response.formData.constructor === Object) {
					/* !TODO-v3: Make auto cleanup Important!
							Also cleanup old created keys in old localStorage - to free up user space
					 */

					const data = {
						tabId: tabId,
						data: response.formData,
					}

					database.putV2([
							{
								IDB:
									{
										// @ts-ignore
										table: FD_DB_NAME,
										data: data
									}
							}
					]);
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

