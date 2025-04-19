const publicExtensionUrl = 'chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/park.html';
const debugTabsInfo = false;

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TabObserver {
	public static readonly tickSize = 10;

	private tabManager: TabManager;
	private static ticker;
	private tickCount = 0;

	constructor(TabManager: TabManager) {
		this.tabManager = TabManager;

		void this.start();
	}

	async start() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		if (TabObserver.ticker) {
			clearInterval(TabObserver.ticker);
			TabObserver.ticker = null;
		}

		if (await settings.get('active'))
			TabObserver.ticker = setInterval(
				()=> {self.tick().catch(console.error)},
				TabObserver.tickSize * 1000
			);
	}

	settingsChanged() {
		this.start().catch(console.error);
		this.tick(true).catch(console.error);
	}

	async tick(stateOnly?: boolean) {

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		/* TODO-v3:
		navigator.getBattery().then(function(battery) {
			if (battery != null && battery.level != null && battery.level >= 0.0)
				batteryLevel = battery.level;
		});*/

		if (!stateOnly) {
			this.tickCount += TabObserver.tickSize;

			if (pauseTics > 0) {
				pauseTics -= TabObserver.tickSize;
				if (pauseTics <= 0) {
					new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
					pauseTicsStartedFrom = 0;
				}
				return;
			}
		}

		// TODO-v4: Make as struct..
		const pinnedSettings = await settings.get('pinned');
		const timeoutSettings = await settings.get('timeout');
		const closeTimeout = await settings.get('closeTimeout');
		const isCloseTabsOn = await settings.get('isCloseTabsOn');
		const ignoreAudible = await settings.get('ignoreAudible');
		const animateTabIconSuspendTimeout = await settings.get('animateTabIconSuspendTimeout');
		const autoSuspendOnlyOnBatteryOnly = await settings.get('autoSuspendOnlyOnBatteryOnly');
		const discardTabAfterSuspendWithTimeout = await settings.get('discardTabAfterSuspendWithTimeout');
		const discardTimeoutFactor = await settings.get('discardTimeoutFactor');
		let enableSuspendOnlyIfBattLvlLessValue = await settings.get('enableSuspendOnlyIfBattLvlLessValue');
		const battLvlLessValue = await settings.get('battLvlLessValue');
		const adaptiveSuspendTimeout = await settings.get('adaptiveSuspendTimeout');
		const ignoreCloseGroupedTabs = await settings.get('ignoreCloseGroupedTabs');

		if (batteryLevel < 0.0)
			enableSuspendOnlyIfBattLvlLessValue = false;


		const cleanedTabsArray = {};

		chrome.windows.getAll({ 'populate': true }, async (windows) => {

			// CLOSE TAB LOGIC
			if (!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging)
				if (isCloseTabsOn && self.tickCount % TabObserver.tickSize == 0) {

					let oneTabClosed = false;
					for (const wi in windows) {
						const tabArray = [];

						let tab;
						let tabFromTabs;
						if (windows.hasOwnProperty(wi))
							for (const j in windows[wi].tabs)
								if (windows[wi].tabs.hasOwnProperty(j)) {
									tab = windows[wi].tabs[j];
									tabFromTabs = self.tabManager.getTabInfoById(tab.id);
									if (tabFromTabs) {
										if (!await self.tabManager.isExceptionTab(tab) && TabManager.isPassGroupedTabsRules(tab, ignoreCloseGroupedTabs))
											tabArray.push(tabFromTabs);
									}
								}

						let minRank = 19999999999;
						let minRankTab = null;
						if (tabArray.length > await settings.get('limitOfOpenedTabs')) {
							const tabRanks: { rank: number, tab: TabInfo }[] = [];

							for (let i = 0; i < tabArray.length; i++) {
								tab = tabArray[i];
								if (tab.time >= closeTimeout) {
									const currentRank = tab.active_time * tab.active_time * (tab.swch_cnt + 1) - tab.time * (tab.parked ? tab.time : 2);
									if (minRank > currentRank) {
										minRank = currentRank;
										minRankTab = tab;
									}
									if (debug) {
										tabRanks.push({rank: currentRank, tab: tab });
									}
								}
							}

							if (debug) {
								tabRanks.sort((a, b) => a.rank - b.rank)
									.forEach((rankInfo) => { console.log(`TabId[${rankInfo.tab.id}] closeRank: ${rankInfo.rank} -> ${rankInfo.tab.lstCapUrl}`, rankInfo.tab); })
							}
						}

						if (minRankTab != null) {
							let tabToClose = null;
							if ((tabToClose = TabManager.tabExist(windows, minRankTab.id)) != null) {
								/*TODO: check for tab is last on whole window!!!*/

								if (!stateOnly)
									closeTab(minRankTab.id, tabToClose);

								oneTabClosed = true;
								break;
							}
						}

						if (oneTabClosed)
							break;
					}

				}

			const steps = 10;
			let oneTabParked = false;
			let refreshIconIndex = 0;

			// SUSPEND TAB LOGIC
			// eslint-disable-next-line no-redeclare
			for (const i in windows) {
				if (windows.hasOwnProperty(i)) {
					// eslint-disable-next-line no-redeclare
					for (const j in windows[i].tabs) {
						if (windows[i].tabs.hasOwnProperty(j)) {

							const tab = windows[i].tabs[j];
							const tabId = tab.id;
							const tabInfo: TabInfo = self.tabManager.getTabInfoOrCreate(tab);

							try {
								if (debugTabsInfo)
									console.log(i, j, tab);
								// eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
							} catch (e) {
							}

							self.tabManager.checkAndTurnOffAutoDiscardable(tab);

							cleanedTabsArray[tabId] = tabInfo;

							{
								const isTabParked = tab.url != null && tab.url.indexOf(parkUrl) == 0;

								/* Restore session logic When uninstall */

								if (!stateOnly) {
									tabInfo.time += TabObserver.tickSize;

									if (isTabParked)
										tabInfo.suspended_time += TabObserver.tickSize;
								}

								if (!oneTabParked /*&& tickCount % 5 == 0*/) {
									if (tabInfo.parkedCount == null)
										tabInfo.parkedCount = 0;

									const calculatedTabTimeFrame = timeoutSettings + timeoutSettings * tabInfo.parkedCount + (tabInfo.active_time + 1) * Math.log2(tabInfo.swch_cnt + 1) + (timeoutSettings / 4) * Math.log2(tabInfo.swch_cnt + 1);

									if (debug && parkUrl !== publicExtensionUrl)
										chrome.action.setBadgeText({
											text: '' + Math.round((calculatedTabTimeFrame - tabInfo.time) / 60) + '|' + tabInfo.swch_cnt,
											tabId: tabId
										}).catch((e) => console.error(tabInfo, e));

									if (!adaptiveSuspendTimeout && tabInfo.time >= timeoutSettings
										|| adaptiveSuspendTimeout && tabInfo.time >= calculatedTabTimeFrame) {
										if (!tab.active &&
											tab.status === 'complete' &&
											TabManager.isTabURLAllowedForPark(tab) &&
											tabInfo.parkTrys <= 2) {
											if (!await self.tabManager.isExceptionTab(tab)) {
												if (!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging) {
													if (enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue / 100 && !isCharging) {
														if (!stateOnly) {
															await parkTab(tab, tabId);
															tabInfo.parkTrys++;
														}
														oneTabParked = true;
													}
												}
											} else {
												tabInfo.time = 0;
												/* TODO: Make a favicon locks*/
											}
										}
									} else {
										if (!stateOnly)
											if (animateTabIconSuspendTimeout &&
												!tab.active &&
												tabInfo.time > 0 &&
												!await self.tabManager.isExceptionTab(tab) &&
												TabManager.isTabURLAllowedForPark(tab) &&
												(!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging) &&
												(enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue / 100 && !isCharging)) {
												const step = Math.round(tabInfo.time / ((timeoutSettings + timeoutSettings * (2 / steps)) / steps));
												const suspendPercent = step * 10;
												if (tabInfo.suspendPercent != suspendPercent) {
													tabInfo.suspendPercent = suspendPercent;
													chrome.tabs.sendMessage(tabId, {
														method: '[AutomaticTabCleaner:highliteFavicon]',
														highliteInfo: { suspendPercent: suspendPercent }
													}).catch((e) => console.error(e));
												}
											}
									}
								}

								/* PINNED TABS */
								if (ignoreAudible && TabManager.isAudible(tab))
									tabInfo.time = 0;

								/* DISCARD TABS */
								if (isTabParked) {
									tabInfo.discarded = tab.discarded;

									/* Refresh susp. tab empty icons */
									if ((tab.favIconUrl == null || tab.favIconUrl === '') && tabInfo.refreshIconRetries < 2) {
										tabInfo.refreshIconRetries = tabInfo.refreshIconRetries + 1;
										const tmpFunction = function(id, discard, index) {
											setTimeout(function() {
												console.log('Refresh susp. tab icon: ' + id);
												chrome.tabs.reload(id, function() {
													if (discard)
														setTimeout(function() {
															discardTab(id);
														}, 2000);
												});
											}, 100 * index);
										};
										tmpFunction(tabId, tabInfo.discarded, refreshIconIndex++);
									}

									if (!tabInfo.discarded && discardTabAfterSuspendWithTimeout)
										if (!tab.active) {
											if (tabInfo.suspended_time >= timeoutSettings * discardTimeoutFactor) {
												// eslint-disable-next-line no-undef
												if (!isTabMarkedForUnsuspend(parseUrlParam(tab.url, 'tabId'), parseUrlParam(tab.url, 'sessionId'))) {
													try {
														discardTab(tabId);
													} catch (e) {
														console.log('Disacrd failed: ', tab, e);
													}

													tabInfo.discarded = true;
												}
											}
										}
								}

								/* DEBUG INFO */
								if (false/*debug*/) {
									if (TabManager.isTabURLAllowedForPark(tab) && tab.discarded == false) {
										try {
											if (TabManager.canTabBeScripted(tab)) {
												chrome.scripting.executeScript({
													target: { tabId: tabId },
													func: (title, tabInfo) => {

														const iTabInfo: ITabInfo = tabInfo as ITabInfo;

														function appendTitleDebug(title, iTabInfo: ITabInfo) {
															const indexOfDebugInfoStart = title.indexOf('^');
															if (indexOfDebugInfoStart == -1)
																return debugInfoString(iTabInfo) + ' ^ ' + title;
															else
																return debugInfoString(iTabInfo) + title.substring(indexOfDebugInfoStart);
														}

														function debugInfoString(iTabInfo: ITabInfo) {
															return '[' + iTabInfo.id + '][' + iTabInfo.time + '][' + iTabInfo.active_time + '][' + iTabInfo.suspended_time + ']';
														}

														document.title = appendTitleDebug(title, iTabInfo);
													},
													args: [tab.title, tabInfo.toObject()]
												}).catch(e => {
													hasLastError(TabCapture.expectedInjectExceptions, e, `Debug title modification tabId: ${tab.id} [${tab.url}]`);
												});
											}
										} catch (e) {
											// normal behavior
											console.trace(e);
										}
									}
								}
							}

							if (!stateOnly) {
								/*																			*/
								/* !!!!!!! LOOKS LIKE DEAD CODE !!!!!!! */
								/*																			*/
								if (tab.active) {
									if (tabInfo != null) {
										tabInfo.time = 0;
										tabInfo.active_time += TabObserver.tickSize * (TabManager.isAudible(tab) ? 1.5 : 1);
										tabInfo.suspended_time = 0;
										tabInfo.parkTrys = 0;
									}
								}
								if (pinnedSettings && tab.pinned)
									tabInfo.time = 0;
							}
						}
					}
				}
			}

			self.tabManager.calculateAndMarkClosedTabs(cleanedTabsArray);
		});
	}
}

// @ts-ignore
if (typeof global !== "undefined") global.TabObserver = TabObserver;