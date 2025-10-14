const sessionsPageUrl = chrome.runtime.getURL('sessions.html');
const wizardPageUrl = chrome.runtime.getURL('wizard_background.html');

interface IntOptions {
	reloadSettings: boolean;
}
interface CaptureTabOptions {
	checkActiveTabNotChanged: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TabManager {

	private tabInfos: { [key: string]: TabInfo } = {};
	private TAB_INFO_CLEANUP_TTL_MS = 60 * 60 * 24 * 1000; /* 24 Hours */
	private COMMON_LOOP_PERIOD_MS = 10000; /* 10 Sec */
	public readonly historyOpenerController = new HistoryOpenerController();
	private commonInterval: number;

	/* For puppeteer tests only */
	public setTabInfoCleanupTtlMs(ttlMs: number) {
		this.TAB_INFO_CLEANUP_TTL_MS = ttlMs;
	}
	/* For puppeteer tests only */
	public setCommonLoopPeriodMs(commonLoopPeriodMs: number) {
		this.COMMON_LOOP_PERIOD_MS = commonLoopPeriodMs;
		this.startCommonLoop(); // Restart Common Loop
	}
	/* For puppeteer tests only */
	public getTabInfosCopy(): TabInfo[] {
		return JSON.parse(JSON.stringify(this.tabInfos));
	}

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
		const bytes = new Uint8Array( buffer );
		const len = bytes.byteLength;

		// For small buffers, use the simple approach
		if (len <= 8192) {
			return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
		}

		// For larger buffers, use chunked processing to avoid call stack limits
		const chunkSize = 8192;
		let binary = '';

		for (let i = 0; i < len; i += chunkSize) {
			const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
			binary += String.fromCharCode.apply(null, Array.from(chunk));
		}

		return btoa(binary);
	}

	base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const len = binaryString.length;
		const bytes = new Uint8Array(len);

		// For small strings, use the simple approach
		if (len <= 8192) {
			for (let i = 0; i < len; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
		} else {
			// For larger strings, use chunked processing for better performance
			const chunkSize = 8192;
			for (let i = 0; i < len; i += chunkSize) {
				const end = Math.min(i + chunkSize, len);
				for (let j = i; j < end; j++) {
					bytes[j] = binaryString.charCodeAt(j);
				}
			}
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

		this.startCommonLoop();

		/** Event ******************************************************************************
		 tabs.onCreated - add to list */
		chrome.tabs.onCreated.addListener(async function(tab: chrome.tabs.Tab) {
			const tabInfo = self.createNewTabInfo(tab);

			if (trace)
				console.trace(`Tab[${tab.id}] Created`, tab);

			self.checkAndTurnOffAutoDiscardable(tab);

			self.historyOpenerController.onNewTab(tab);

			// Check if tab should be suspended (Ctrl+Click or Cmd+Click)
			if (nextTabShouldBeSuspended && tab.active === false && await settings.get('suspendOnCtrlClick')) {
				nextTabShouldBeSuspended = false; // Reset flag

				// Get URL for suspension
				const urlForSuspend = tab.pendingUrl || tab.url;

				// Verify URL is valid before marking for suspension
				// NOTE: Don't save URL here if it's about:blank - we'll get the real URL in onUpdated
				if (urlForSuspend &&
					urlForSuspend !== 'null' &&
					urlForSuspend !== 'undefined' &&
					urlForSuspend !== 'about:blank' &&
					!urlForSuspend.startsWith('chrome-extension://') &&
					!urlForSuspend.startsWith('chrome://')) {
					console.log(`Tab[${tab.id}] marked for suspension (Ctrl/Cmd+Click detected), URL: ${urlForSuspend}`);

					// Mark tab to suspend when favicon loads
					tabInfo.markedForLoadSuspended = true;
					tabInfo.originalUrlBeforeSuspend = urlForSuspend;
				} else if (urlForSuspend === 'about:blank' || !urlForSuspend) {
					// URL is not ready yet (about:blank or empty), mark for suspension but don't save URL
					// We'll get the real URL in onUpdated
					console.log(`Tab[${tab.id}] marked for suspension (Ctrl/Cmd+Click), but URL not ready yet (${urlForSuspend}), will wait for real URL`);
					tabInfo.markedForLoadSuspended = true;
					// Don't set originalUrlBeforeSuspend - we'll get it from updatedTab.url in onUpdated
				} else {
					console.warn(`Tab[${tab.id}] skipping suspension - invalid URL: "${urlForSuspend}"`);
				}
			}
			if (nextTabShouldBeSuspended && !await settings.get('suspendOnCtrlClick')) {
				// Reset flag if setting is disabled
				nextTabShouldBeSuspended = false;
			}

			if (tab.active === false)
				if (await settings.get('openUnfocusedTabDiscarded') == true) {
					tabInfo.markedForDiscard = true;
				}
		});

		/** Event ******************************************************************************
		 tabs.onReplaced */
		chrome.tabs.onReplaced.addListener((addedTabId: number, removedTabId: number) => {
			self.onTabReplaceDetected(addedTabId, removedTabId);
		});

		/** Event ******************************************************************************
		 tabs.onUpdated */
		chrome.tabs.onUpdated.addListener((_tabId: number, changeInfo: TabChangeInfo, tab: chrome.tabs.Tab) => {
			const tabInfo = self.getTabInfoOrCreate(tab);

			this.historyOpenerController.onTabUpdate(_tabId, changeInfo);

			if (trace)
				console.trace(`Tab[${tab.id}] updated: `, changeInfo, tab);

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
										if (debugScreenCache)
											console.log('Screen cached.');
									} else {
										if (debugScreenCache)
											console.log('Screen cache outdated!');
									}
									resolve(); // Always resolve, even if cache was cleared
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

			// Check if tab should be suspended without screenshot (Ctrl/Cmd+Click)
			if (tabInfo.markedForLoadSuspended === true && tab.active === false) {
				// Wait for status=complete to ensure we have all metadata
				if (tab.status === 'complete') {
					console.log(`Tab[${tab.id}] complete, waiting for favicon to load`);

					// Poll for favicon with retries
					const MAX_ATTEMPTS = 10;
					const POLL_INTERVAL_MS = 200;
					let attempts = 0;

					const pollForFavicon = () => {
						attempts++;
						chrome.tabs.get(tab.id).then((updatedTab) => {
							// Get the URL - prefer saved URL, but use current tab URL if not saved or if saved was about:blank
							let originalUrl = tabInfo.originalUrlBeforeSuspend;
							if (!originalUrl || originalUrl === 'about:blank') {
								originalUrl = updatedTab.url;
							}

							// Verify URL is valid and not still about:blank
							if (!originalUrl ||
								originalUrl === 'null' ||
								originalUrl === 'undefined' ||
								originalUrl === 'about:blank' ||
								originalUrl.startsWith('chrome-extension://') ||
								originalUrl.startsWith('chrome://')) {

								// If we haven't reached max attempts and URL is still about:blank, keep trying
								if (originalUrl === 'about:blank' && attempts < MAX_ATTEMPTS) {
									console.log(`Tab[${tab.id}] attempt ${attempts}/${MAX_ATTEMPTS}, URL still about:blank, retrying...`);
									setTimeout(pollForFavicon, POLL_INTERVAL_MS);
									return;
								}

								console.error(`Tab[${tab.id}] cannot suspend - invalid URL: "${originalUrl}" after ${attempts} attempts. Skipping suspension.`);

								// Clear flags and do NOT park
								tabInfo.markedForLoadSuspended = false;
								tabInfo.originalUrlBeforeSuspend = null;
								return;
							}

							// Check if we have favicon or reached max attempts
							if (updatedTab.favIconUrl || attempts >= MAX_ATTEMPTS) {
								let url = parkUrl;
								url += '?tabId=' + encodeURIComponent(updatedTab.id);
								url += '&title=' + encodeURIComponent(updatedTab.title || 'New Tab');
								url += '&url=' + encodeURIComponent(originalUrl);
								url += '&sessionId=' + encodeURIComponent(TSSessionId);
								if (updatedTab.favIconUrl)
									url += '&icon=' + encodeURIComponent(updatedTab.favIconUrl);

								console.log(`Tab[${tab.id}] suspending after ${attempts} attempts, title:"${updatedTab.title}" favicon:${updatedTab.favIconUrl != null}, url:"${originalUrl}"`);

								// Clear flags
								tabInfo.markedForLoadSuspended = false;
								tabInfo.originalUrlBeforeSuspend = null;

								chrome.tabs.update(updatedTab.id, { url: url }).then(() => {
									self.markTabParked(updatedTab);
								}).catch(console.error);
							} else {
								// Favicon not ready yet, try again
								console.log(`Tab[${tab.id}] attempt ${attempts}/${MAX_ATTEMPTS}, no favicon yet, retrying...`);
								setTimeout(pollForFavicon, POLL_INTERVAL_MS);
							}
						}).catch(console.error);
					};

					// Start polling after initial delay
					setTimeout(pollForFavicon, POLL_INTERVAL_MS);

					return; // Skip further processing
				}
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
							void tabCapture.captureTab(tab);
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
					tabInfo.parkedUrl != changeInfo.url) {
					// Clear parkedUrl only when navigating to a new regular URL (not parkUrl)
					if (changeInfo.url.indexOf(parkUrl) !== 0) {
						tabInfo.parkedUrl = null;
					}
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
							void tabCapture.captureTab(tab);
						}, 150);
			}
		});

		/** Event ******************************************************************************
		  tabs.onRemoved - load if unloaded, remove from list
		 ***************************************************************************************/
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		chrome.tabs.onRemoved.addListener(function(tabId, removeInfo: chrome.tabs.TabRemoveInfo) {
			if (trace)
				console.trace(`Tab[${tabId}] removed`);

			self.markTabClosed(tabId);

			self.historyOpenerController.onRemoveTab(tabId);
		});

	  /** Event ******************************************************************************
		 tabs.onSelectionChanged - load if unloaded, reset inactivity */
		chrome.tabs.onActivated.addListener(function(activeInfo) {

			//console.log(`Fired: OnTab Activated: ${activeInfo.tabId}`, activeInfo);

			const processedPromise = new Promise<chrome.tabs.Tab>((resolve, reject) => {

				let retries = 0;

				const attemptGetTab = async () => {
					if (retries > 5) {
						console.error('Can\'t request Tab object on TabActivated (5 retries left)', activeInfo);
						reject();
						return;
					}
					if (retries > 1) {
						console.warn(`Trying to request Tab object on TabActivated (${retries})`, activeInfo);
					}
					retries++;

					try {
						const tab = await chrome.tabs.get(activeInfo.tabId);
						if (tab != null) {
							resolve(tab);
						} else {
							// Tab is null, retry after delay
							setTimeout(attemptGetTab, 150);
						}
					} catch (e) {
						console.log(e);
						// Continue retrying after delay
						setTimeout(attemptGetTab, 150);
					}
				};

				// Start first attempt
				void attemptGetTab();

			});

			processedPromise.then(async (tab: chrome.tabs.Tab) => {

				//if (debug) {
					console.log(`OnTab Activated: ${activeInfo.tabId}`, tab);
				//}

				self.markTabActivated(tab);

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

	private onTabReplaceDetected(addedTabId: number, removedTabId: number): TabInfo {
		if (trace)
			console.trace(`Tab Replaced: ${removedTabId} -> ${addedTabId}`, this.tabInfos);

		this.tabInfos[addedTabId] = this.tabInfos[removedTabId];
		this.tabInfos[addedTabId].id = addedTabId;
		this.tabInfos[addedTabId].oldRefId = removedTabId;
		this.tabInfos[removedTabId].newRefId = addedTabId;

		chrome.tabs.get(addedTabId, (tab) => {
			if (tab == null)
				return;
			if (tab.url.indexOf(parkUrl) == 0) {
				const originTabId = parseUrlParam(tab.url, 'tabId');

				if (originTabId == removedTabId.toString()) {
					this.tabInfos[addedTabId].originRefId = removedTabId;
				} else {
					this.tabInfos[removedTabId] = structuredClone(this.tabInfos[removedTabId]);
					this.markTabClosed(removedTabId);
					console.warn(`Tab Replaced: ${removedTabId} -> ${addedTabId} - Intermediate replace -> mark tab info can be removed for ${removedTabId}`);
				}
				//params.set('tabId', addedTabId.toString());
				///// ******** Looks like it does not working!!!!!!!
				//chrome.tabs.update(addedTabId, { url: url.toString() }).catch(console.error);
				//^^^^ Where to store tab-key in case of chrome.tabs.update() not working??????
			}
		});


		if (trace)
			console.trace(`Tab Replaced: ${removedTabId} -> ${addedTabId} complete`, this.tabInfos);

		return this.tabInfos[addedTabId];
	}

	private startCommonLoop() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		if (this.commonInterval != null) {
			clearInterval(this.commonInterval);
			this.commonInterval = null;
		}

		// @ts-ignore
		this.commonInterval = setInterval(() => {
			void self.storeTabInfos();
			self.clearClosedTabs();
		}, this.COMMON_LOOP_PERIOD_MS);
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

	private markTabClosed(tabId: string | number) {
		const tabInfo = this.getTabInfoById(tabId);

		if (tabInfo != null)
			this.tabInfos[tabId].closed = <TabInfoClosedInfo>{
				at: Date.now(),
				tsSessionId: TSSessionId,
			};
		else {
			console.error(`TabManager.markTabDeleted() tabInfo not found for tabId: `, tabId);
		}
	}

	private deleteTab(tabId: string) {
		if (this.tabInfos.hasOwnProperty(tabId))
			delete this.tabInfos[tabId];
	}

	public createNewTabInfo(tab: chrome.tabs.Tab): TabInfo {
		const tabInfo = new TabInfo(tab);
		return this.tabInfos[tab.id] = tabInfo;
	}

	getTabInfoOrCreate(tab: chrome.tabs.Tab): TabInfo {
		let tabInfo = this.getTabInfoById(tab.id);

		/* If Parked Tab (Usually after browser restart) */
		if(tabInfo == null && tab.url.startsWith(parkUrl)) {
			const removedTabId = parseInt(parseUrlParam(tab.url, 'tabId'));
			const originalUrl = parseUrlParam(tab.url, 'url');
			console.log(`Found parked[${removedTabId}] Tab[${tab.id}] without TabInfo, starting id replace..`);
			if (this.tabInfos[removedTabId] == null) {
				// Create TabInfo with proper original data
				const restoredTabInfo = new TabInfo({ id: removedTabId, url: originalUrl } as chrome.tabs.Tab);
				restoredTabInfo.parkedUrl = originalUrl;
				restoredTabInfo.parked = true;
				this.tabInfos[removedTabId] = restoredTabInfo;
			}
			tabInfo = this.onTabReplaceDetected(tab.id, removedTabId);
		}

		if (tabInfo == null)
			tabInfo = this.createNewTabInfo(tab);

		return tabInfo;
	};

	getTabInfoById(tabId: string | number): TabInfo {
		try {
			return this.tabInfos[tabId];
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (e) {}
	}
	findReplacedTabById(tabId: number): TabInfo {
		let tab = this.getTabInfoById(tabId);
		if (tab == null) {
			const replacedTabId = this.findReplacedTabId(tabId);
			tab = this.getTabInfoById(replacedTabId);
		}
		return tab;
	}

	findReplacedTabId(tabId: number): number {
		const tabInfo = this.getTabInfoById(tabId);
		if (tabInfo && tabInfo.newRefId != null)
			tabId = tabInfo.newRefId;
		return tabId;
	}

	private markTabActivated(tab: chrome.tabs.Tab) {
		const tabInfo = this.getTabInfoById(tab.id);
		if (tabInfo != null) {
			tabInfo.lstSwchTime = Date.now();
			//const tabInfo = new TabInfo(tab);
			tabInfo.swch_cnt++;
			tabInfo.time = 0;
			tabInfo.active_time += TabObserver.tickSize * (TabManager.isAudible(tab) ? 1.5 : 1);
			tabInfo.suspended_time = 0;
			tabInfo.parkTrys = 0;
		} else {
			console.warn(`markTabActivated: TabInfo was not registered!`, tab);
		}
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

	public calculateAndMarkClosedTabs(openedChromeTabs: { [key: number]: chrome.tabs.Tab }) {

		const suspendedChromeTabs = {};
		Object.values(openedChromeTabs).forEach((tab) => {
			if (tab.url.indexOf(parkUrl) == 0) {
				const originTabId = parseUrlParam(tab.url, 'tabId');
				suspendedChromeTabs[originTabId] = tab;
			}
		});

		// Grace period before marking tabs as closed to handle API timing issues
		const GRACE_PERIOD_MS = 30000; // 30 seconds

		for (const tabId in this.tabInfos) {
			if (this.tabInfos.hasOwnProperty(tabId)) {
				const tabInfo = this.tabInfos[tabId];
				if (openedChromeTabs[tabId] == null && suspendedChromeTabs[tabId] == null) {
					if (tabInfo.closed == null) {
						// Mark as potentially closed, but give grace period
						if (!tabInfo.missingCheckTime) {
							tabInfo.missingCheckTime = Date.now();
						} else if (Date.now() - tabInfo.missingCheckTime > GRACE_PERIOD_MS) {
							// Only mark as closed after grace period
							console.log(`Tab ${tabId} marked as closed after grace period`);
							tabInfo.closed = <TabInfoClosedInfo>{
								at: Date.now(),
								tsSessionId: TSSessionId,
							};
							tabInfo.missingCheckTime = null;
						}
					}
				} else {
					// Tab found again, clear missing check
					if (tabInfo.missingCheckTime != null) {
						tabInfo.missingCheckTime = null;
					}
				}
			}
		}
	}

	clearClosedTabs() {
		for (const tabId in this.tabInfos) {
			if (this.tabInfos.hasOwnProperty(tabId)) {
				const tabInfo = this.tabInfos[tabId];
				if (tabInfo == null) {
					console.warn(`TabInfo[${tabId}] exist, but undefined!`);
					this.deleteTab(tabId);
				}
				else if (tabInfo.closed != null) {
					if (Date.now() > tabInfo.closed.at + this.TAB_INFO_CLEANUP_TTL_MS) {
						console.log(`Clear closed tab[${tabId}]`, tabInfo);
						this.deleteTab(tabId);
					}
				}
			}
		}
	}

	private async isTabException(tab: chrome.tabs.Tab) {
		// Audible
		if (TabManager.isAudible(tab) && await settings.get('ignoreAudible'))
			return true;

		// Pinned Tab
		if (tab.pinned == true && await settings.get('pinned'))
			return true;

		// Grouped Tab
		if (tab.groupId !== -1 && await settings.get('ignoreSuspendGroupedTabs'))
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

	checkAndTurnOffAutoDiscardable(tab: chrome.tabs.Tab) {
		if (tab.autoDiscardable === true)
			try {
				chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(console.error);
			} catch (error) {
				if (error.message.includes('split mode')) {
					console.log('Tab is in split mode, skipping autoDiscardable setting');
				} else {
					throw error;
				}
			}
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
		//debugger;
		if (!url) url = window.location.href;
		// eslint-disable-next-line no-useless-escape
		name = name.replace(/[\[\]]/g, '\\$&');
		const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
			results = regex.exec(url);
		if (!results) return null;
		if (!results[2]) return '';
		return decodeURIComponent(results[2].replace(/\+/g, ' '));
	}

	static tabExist(windows: chrome.windows.Window[], tabId: number) {
		for (const i in windows)
			if (windows.hasOwnProperty(i))
				for (const j in windows[i].tabs)
					if (windows[i].tabs.hasOwnProperty(j))
						if (windows[i].tabs[j].id == tabId)
							return windows[i].tabs[j];
		return null;
	}
}

if (typeof module != 'undefined')
	module.exports = {
		TabManager,
	}