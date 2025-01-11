
interface IntOptions {
	reloadSettings: boolean;
}
interface CaptureTabOptions {
	checkActiveTabNotChanged: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TabManager {

	private tabInfos: { [key: number]: TabInfo } = {};
	public readonly historyOpenerController = new HistoryOpenerController();

	async compress(str: string, encoding = 'gzip' as CompressionFormat): Promise<ArrayBuffer> {
		const byteArray = new TextEncoder().encode(str);
		const cs = new CompressionStream(encoding);
		const writer = cs.writable.getWriter();
		void writer.write(byteArray);
		void writer.close();
		return new Response(cs.readable).arrayBuffer();
	}

	async decompress(byteArray: ArrayBuffer, encoding = 'gzip' as CompressionFormat): Promise<string> {
		const cs = new DecompressionStream(encoding)
		const writer = cs.writable.getWriter()
		void writer.write(byteArray)
		void writer.close()
		const arrayBuffer = await new Response(cs.readable).arrayBuffer()
		return new TextDecoder().decode(arrayBuffer)
	}

	arrayBufferToBase64( buffer: ArrayBuffer ): string {
		let binary = '';
		const bytes = new Uint8Array( buffer );
		const len = bytes.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode( bytes[ i ] );
		}
		return btoa( binary );
	}

	base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	async storeTabInfos() {
		try {
			const tabInfosJson = JSON.stringify(this.tabInfos);
			const tabInfosByteArray = await this.compress(tabInfosJson);
			const tabInfosCompressedBase64 = this.arrayBufferToBase64(tabInfosByteArray);
			await chrome.storage.local.set({ [this.TAB_INFOS_KEY]: tabInfosCompressedBase64 });
		} catch (e) {
			console.error(`storeTabInfos() failed`, e);
		}
	}

	private loadTabInfos() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		chrome.storage.local.get(this.TAB_INFOS_KEY).then(async (result) => {
			const loadedITabInfosCompressedBase64: string  = result[self.TAB_INFOS_KEY];

			if (loadedITabInfosCompressedBase64 != null && loadedITabInfosCompressedBase64.trim().length > 0) {
				const iTabInfosCompressedArrayBuffer = this.base64ToArrayBuffer(loadedITabInfosCompressedBase64);
				const iTabInfosJson = await this.decompress(iTabInfosCompressedArrayBuffer);
				const loadedITabInfos: { [key: number]: ITabInfo } = JSON.parse(iTabInfosJson);
				//const loadedITabInfos: { [key: number]: ITabInfo } = result[self.TAB_INFOS_KEY];

				for (const propertyName in loadedITabInfos) {
					if (loadedITabInfos.hasOwnProperty(propertyName)) {
						self.tabInfos[propertyName] = TabInfo.fromObject(loadedITabInfos[propertyName]);
					}
				}
				console.log(`tabInfos loaded`);
			}
		}).catch(console.error);
	}

	private readonly TAB_INFOS_KEY = 'tabInfos';

	constructor() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		this.loadTabInfos();

		setInterval(()=>{
			void self.storeTabInfos();
		}, 10000);

		/** Event ******************************************************************************
		 tabs.onCreated - add to list */
		chrome.tabs.onCreated.addListener(async function(tab: chrome.tabs.Tab) {
			const tabInfo = tabManager.createNewTabInfo(tab);

			if (trace)
				console.trace('Event: Tab Created: ', tab);

			self.checkAndTurnOffAutoDiscardable(tab);

			self.historyOpenerController.onNewTab(tab);

			if (tab.active === false)
				if (await settings.get('openUnfocusedTabDiscarded') == true) {
					tabInfo.markedForDiscard = true;
				}
		});

		/** Event ******************************************************************************
		 tabs.onReplaced */
		chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
			if (trace)
				console.trace(`Tab Replaced: ${removedTabId} -> ${addedTabId}`);

			/*chrome.tabs.get(addedTabId, (tab) => {
				if (tab.url.indexOf(parkUrl) == 0) {
					const url = new URL(tab.url);
					const params = url.searchParams;
					const oldTabId = params.get('tabId');
					if (oldTabId != removedTabId.toString())	{
						console.warn(`Tab Replaced: ${removedTabId} -> ${addedTabId} - TabId mismatch in url: ${oldTabId} != ${removedTabId}`);
					}
					params.set('tabId', addedTabId.toString());
					chrome.tabs.update(addedTabId, { url: url.toString() }).catch(console.error);
				}
			});*/
			self.tabInfos[addedTabId] = self.tabInfos[removedTabId];
			self.tabInfos[addedTabId].id = addedTabId;
			self.tabInfos[addedTabId].oldRefId = removedTabId;
			self.tabInfos[removedTabId].newRefId = addedTabId;
		});

		/** Event ******************************************************************************
		 tabs.onUpdated */
		chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab: chrome.tabs.Tab) => {
			const tabInfo = self.getTabInfoOrCreate(tab);

			this.historyOpenerController.onTabUpdate(_tabId, changeInfo);

			if (trace)
				console.trace(`Event Tab[${tab.id}] updated: `, changeInfo, tab);

			if (changeInfo.discarded == false && tab.active == true && TabManager.isTabParked(tab) && getScreenCache == null)
				try {
					const sessionId = parseUrlParam(tab.url, 'sessionId');
					const tabId = parseUrlParam(tab.url, 'tabId');
					if (sessionId != null && tabId != null) {
						/* TODO-v4: Extract this business logic from TabManager to ScreenshotController.ts */
						getScreenCache = {
							sessionId: sessionId,
							tabId: tabId,
							getScreenPromise: new Promise<void>((resolve) => {
								ScreenshotController.getScreen(tabId, sessionId, (screen, pixRat) => {
									if (getScreenCache != null) {
										getScreenCache.screen = screen;
										getScreenCache.pixRat = pixRat;
										resolve();
										if (debugScreenCache)
											console.log('Screen cached.');
									} else {
										if (debugScreenCache)
											console.log('Screen cache outdated!');
									}
								});
							})
						};
					}
				} catch (e) {
					console.error(e);
				}

			try {
				if (tab.active == false && tab.status === 'loading') {
					if (tabInfo.markedForDiscard == true) {
						if (tab.favIconUrl != null && tab.title != null && tab.title != tab.url) {
							console.log('Discarding Tab: ', tab.url);
							discardTab(tab.id);
							tabInfo.discarded = true;
						}
					}
				}
			} catch (e) {
				console.error(e);
			}

			if (debug && Object.keys(changeInfo).length == 1 && Object.keys(changeInfo)[0] == 'title')
				return;

			if (Object.keys(changeInfo).length == 1 && Object.keys(changeInfo)[0] == 'favIconUrl')
				return;

			let captured = false;

			if (changeInfo.status === 'complete') {
				if (debug)
					console.log('Tab Updated', tab);

				tabInfo.nonCmpltInput = false;

				if (tab.active === true) {
					if (TabManager.isTabURLAllowedForPark(tab)) {
						setTimeout(function() {
							tabCapture.captureTab(tab);
						}, 150);
						captured = true;
					}

					/* Change Icon to green */
					void new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).updateStatus(tab);
				}

				if (TabManager.isTabParked(tab))
					chrome.tabs.getZoom(tab.id, function(zoomFactor) {
						if (zoomFactor != 1.0)
							chrome.tabs.setZoom(tab.id, 1.0)
								.catch(console.error);
					});
			}

			if (changeInfo.url != null) {
				if (tabInfo.parkedUrl != null &&
					tabInfo.parkedUrl != changeInfo.url)
					if (!(changeInfo.url.indexOf(parkUrl) == 0 && tabInfo.parkedUrl.indexOf(parkUrl) < 0)) {
						tabInfo.parkedUrl = null;
					}
			}

			if (TabManager.isTabParked(tab)) {
				tabInfo.parked = true;
				if (changeInfo.discarded != null && changeInfo.discarded == false)
					tabInfo.discarded = false;
			} else {
				tabInfo.parked = false;

				if (tab.active == true)
					if (!captured && changeInfo.status != 'loading')
						setTimeout(function() {
							tabCapture.captureTab(tab);
						}, 150);
			}
		});

		/** Event ******************************************************************************
		  tabs.onRemoved - load if unloaded, remove from list
		 ***************************************************************************************/
		chrome.tabs.onRemoved.addListener(function(tabId) {
			if (trace)
				console.trace(`Event Tab[${tabId}] removed`);

			self.markTabClosed(tabId);

			self.historyOpenerController.onRemoveTab(tabId);
		});

	  /** Event ******************************************************************************
		 tabs.onSelectionChanged - load if unloaded, reset inactivity */
		chrome.tabs.onActivated.addListener(function(activeInfo) {
			const processedPromise = new Promise((resolve, reject) => {

				let retries = 0;
				const timeout = setInterval(() => {
					if (retries > 5) {
						clearInterval(timeout);
						console.error('Can\'t request Tab object on TabActivated (5 retries left)', activeInfo);
						reject();
						return;
					}
					if (retries > 1) {
						console.warn(`Trying to request Tab object on TabActivated (${retries})`, activeInfo);
					}
					retries++;
					try {
						chrome.tabs.get(activeInfo.tabId, function(tab) {
							if (tab != null) {
								clearInterval(timeout);
								resolve(tab);
							}
						});
					} catch (e) {
						console.log(e);
					}

				}, 150);

			});

			processedPromise.then(async (tab: chrome.tabs.Tab) => {

				if (debug) {
					console.log(`OnTab Activated: ${activeInfo.tabId}`, tab);
				}

				self.markTabActivated(tab);

				/* TODO-v4: This is business logic -> need to be moved form TabManager */
				try {
					if (TabManager.isTabParked(tab)) {
						if (await settings.get('autoRestoreTab'))
							self.unsuspendTab(tab);
					} else if (!tab.discarded && await settings.get('animateTabIconSuspendTimeout'))
						chrome.tabs.sendMessage(activeInfo.tabId, {
							method: '[AutomaticTabCleaner:highliteFavicon]',
							highliteInfo: { suspendPercent: 0 }
						}).catch(console.error);
				} catch (e) {
					console.error(e);
				}

				try {
					if (/*isTabURLAllowedForPark(tab) &&*/ !TabManager.isTabParked(tab) && tab.url.indexOf(sessionsPageUrl) == -1) {
						if (!tab.discarded)
							(function(closureTab) {
								setTimeout(function() {
									void tabCapture.captureTab(closureTab, <CaptureTabOptions>{ checkActiveTabNotChanged: true });
								}, 400);
							})(tab);

						self.updateSwitchTime(tab);
					}
				} catch (e) {
					console.error(e);
				}

				try {
					if (tab.url.indexOf(sessionsPageUrl) == 0)
						chrome.tabs.sendMessage(tab.id, { 'method': '[AutomaticTabCleaner:updateSessions]' }).catch(console.error);
					if (tab.url.indexOf(historyPageUrl) == 0)
						chrome.tabs.sendMessage(tab.id, { 'method': '[AutomaticTabCleaner:updateHistoryPage]' }).catch(console.error);
				} catch (e) {
					console.error(e);
				}

				/* Change Icon to green */
				void new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).updateStatus(tab);
			}).catch(console.error);
		});
	}

	/***************************************************************************************
	 * Methods
	 **************************************************************************************/

	/*** Methods **/

	init(options: IntOptions) {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		// get all windows with tabs
		chrome.windows.getAll({ 'populate': true }, async function(wins) {
			try {
				let i, j, id, firstWindow;
				// get all tabs, init array with 0 inactive time
				for (i in wins) {
					if (wins.hasOwnProperty(i)) {
						if (firstWindow == null)
							firstWindow = wins[i].id;

						for (j in wins[i].tabs) {
							if (wins[i].tabs.hasOwnProperty(j)) {
								id = wins[i].tabs[j].id;

								/* TURN OFF AUTO DISCARDABLE */
								self.checkAndTurnOffAutoDiscardable(wins[i].tabs[j]);

								// HISTORY SUPPORT LOGIC
								self.historyOpenerController.collectInitialTabState(wins[i].tabs[j]);

								if (options == null || options.reloadSettings == null || options.reloadSettings == false)
									if (TabManager.isTabURLAllowedForPark(wins[i].tabs[j]) && wins[i].tabs[j].discarded == false)
										tabCapture.injectJS(id, wins[i].tabs[j]);

								/* COLLECT TABS INFO */
								self.getTabInfoOrCreate(wins[i].tabs[j]);
							}
						}
					}
				}
			} catch (e) {
				console.error('Exception while restoreTabFromLstSession:', e);
			}
		});
	}

	unsuspendTab(tab: chrome.tabs.Tab) {
		if (tab.discarded == true) {
			markForUnsuspend(tab);
			chrome.tabs.reload(tab.id, ).catch(console.error)
		} else {
			if (tab.status == 'loading') {
				settings.get('reloadTabOnRestore')
					.then(reloadTabOnRestore => {
						if (reloadTabOnRestore == true)
							chrome.tabs.update(tab.id, { 'url': parseUrlParam(tab.url, 'url') }).catch(console.error);
						else {
							markForUnsuspend(tab);
						}
					}).catch(console.error);
			} else
				chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:RestoreMessage]', 'tab': tab }).catch(console.error);
		}
	}

	private markTabClosed(tabId: number) {
		const tabInfo = this.getTabInfoById(tabId);

		if (tabInfo != null)
			this.tabInfos[tabId].closed = <TabInfoClosedInfo>{
				at: Date.now(),
				tsSessionId: TSSessionId,
			};
		else {
			console.error(`TabManager.markTabDeleted() tabInfo not found for tabId: ${tabId}`);
		}
	}

	private deleteTab(tabId: number) {
		const tabInfo = this.getTabInfoById(tabId);

		if (tabInfo != null)
			delete this.tabInfos[tabId];
	}


	private createNewTabInfo(tab: chrome.tabs.Tab): TabInfo {
		const tabInfo = new TabInfo(tab);
		return this.tabInfos[tab.id] = tabInfo;
	}

	getTabInfoOrCreate(tab: chrome.tabs.Tab): TabInfo {
		let tabInfo = this.getTabInfoById(tab.id);

		if (tabInfo == null)
			tabInfo = tabManager.createNewTabInfo(tab);

		return tabInfo;
	};

	getTabInfoById(tabId: number): TabInfo {
		try {
			return this.tabInfos[tabId];
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (e) {}
	}


	findReplacedTabId(tabId: number): number {
		const tabInfo = tabManager.getTabInfoById(tabId);
		if (tabInfo && tabInfo.newRefId != null)
			tabId = tabInfo.newRefId;
		return tabId;
	}

	private updateSwitchTime(tab: chrome.tabs.Tab) {
		const tabInfo = this.getTabInfoById(tab.id);
		if (tabInfo != null)
			tabInfo.lstSwchTime = Date.now();
	}

	private markTabActivated(tab: chrome.tabs.Tab) {
		const tabInfo = new TabInfo(tab);
		tabInfo.swch_cnt++;
		tabInfo.time = 0;
		tabInfo.active_time += TabObserver.tickSize * (TabManager.isAudible(tab) ? 1.5 : 1);
		tabInfo.suspended_time = 0;
		tabInfo.parkTrys = 0;
	}

	markTabParked(tab: chrome.tabs.Tab) {
		const tabInfo = this.getTabInfoOrCreate(tab);
		if (tabInfo.parkedUrl != null) {
			if (extractHostname(tabInfo.parkedUrl) == extractHostname(tabInfo.lstCapUrl))
				tabInfo.parkedCount += 1;
			else
				tabInfo.parkedCount = 0;
		} else
			tabInfo.parkedCount += 1;

		if (tab.url.indexOf(parkUrl) == 0)
			tabInfo.parkedUrl = TabManager.getParameterByName('url', tab.url); //getTabInfo(tab).lstCapUrl;
		else
			tabInfo.parkedUrl = tab.url;

		tabInfo.parked = true;
	}

	markTabParkedFromInject(tabId: number) {
		const tabInfo = this.getTabInfoById(tabId);
		if (tabInfo != null)
			tabInfo.parked = true;
	}

	setTabUnsuspended(tab: chrome.tabs.Tab) {
		const tabInfo = this.getTabInfoOrCreate(tab);
		tabInfo.time = 0;
		tabInfo.suspended_time = 0;
		tabInfo.parkTrys = 0;
	}


	setLastCaptureUrl(tab: chrome.tabs.Tab) {
		const tabInfo = this.getTabInfoOrCreate(tab);
		tabInfo.lstCapUrl = tab.url;
		tabInfo.lstCapTime = Date.now();
	}

	calculateAndMarkClosedTabs(openedNowTabInfos: { [key: number]: TabInfo }) {
		for (const tabId in this.tabInfos) {
			if (this.tabInfos.hasOwnProperty(tabId)) {
				const tabInfo = this.tabInfos[tabId];
				if (openedNowTabInfos[tabId] == null) {
					if (tabInfo.closed == null) {
						tabInfo.closed = <TabInfoClosedInfo>{
							at: Date.now(),
							tsSessionId: TSSessionId,
						};
					}
				}
			}
		}
	}

	// TODO-v3: Implement cleanup closed tabInfos
	/*clearClosedTabs() {
		for (const tabId in this.tabInfos) {
			if (this.tabInfos.hasOwnProperty(tabId)) {
				const tabInfo = this.tabInfos[tabId];
				if (tabInfo.closed != null) {
					self.deleteTab(tabId);
				}
			}
		}
	}*/

	private async isTabException(tab: chrome.tabs.Tab) {
		// Audible
		if (TabManager.isAudible(tab) && await settings.get('ignoreAudible'))
			return true;

		// Pinned Tab
		if (tab.pinned == true && await settings.get('pinned'))
			return true;

		//Tab Ignore List
		// eslint-disable-next-line no-undef
		if (ignoreList.isTabInIgnoreTabList(tab.id))
			return true;

		// Not complete input
		// eslint-disable-next-line no-undef
		if (this.getTabInfoOrCreate(tab).nonCmpltInput)
			return true;

		return false;
	}

	async isExceptionTab(tab: chrome.tabs.Tab) {
		try {
			return await this.isTabException(tab) || whiteList.isURIException(tab.url);
		} catch (ex) {
			console.error(ex);
			return await this.isTabException(tab);
		}
	}

	checkAndTurnOffAutoDiscardable(tab) {
		if (tab.autoDiscardable === true)
			chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(console.error);
	};

	private static readonly CHROME_STORE_URL_1 = 'https://chrome.google.com/webstore';
	private static readonly CHROME_STORE_URL_2 = 'https://chromewebstore.google.com';

	/*** Static ***/
	static isTabURLAllowedForPark(tab: chrome.tabs.Tab) {
		return (tab.url.substring(0, tab.url.indexOf(':')) == 'http' ||
			( tab.url.substring(0, tab.url.indexOf(':')) == 'https' && (
				tab.url.indexOf(TabManager.CHROME_STORE_URL_1) < 0
				&& tab.url.indexOf(TabManager.CHROME_STORE_URL_2) < 0
			) ) ||
			tab.url === wizardPageUrl);
	}

	static canTabBeScripted(tab: chrome.tabs.Tab): boolean {
		return tab.url.indexOf('chrome://extensions/') < 0
			&& tab.url.indexOf('chrome://settings/') < 0
			&& tab.url.indexOf(TabManager.CHROME_STORE_URL_1) < 0
			&& tab.url.indexOf(TabManager.CHROME_STORE_URL_2) < 0;
	}

	static isTabParked(tab: chrome.tabs.Tab) {
		return tab.url.substring(0, tab.url.indexOf('?')) === parkUrl;
	};

	static isAudible(tab: chrome.tabs.Tab) {
		return (typeof tab.audible == 'boolean' && tab.audible == true);
	}

	static isPassGroupedTabsRules(tab: chrome.tabs.Tab, ignoreCloseGroupedTabs: boolean) {
		return tab.groupId === -1 || (tab.groupId !== -1 && !ignoreCloseGroupedTabs);
	}

	static getParameterByName(name, url) {
		debugger;
		if (!url) url = window.location.href;
		// eslint-disable-next-line no-useless-escape
		name = name.replace(/[\[\]]/g, '\\$&');
		const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
			results = regex.exec(url);
		if (!results) return null;
		if (!results[2]) return '';
		return decodeURIComponent(results[2].replace(/\+/g, ' '));
	}
}