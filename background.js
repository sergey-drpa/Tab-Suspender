/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

const INSTALLED = 'installed';
(function() {
	let Copyright = 'Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy. Zadorozhniy.Sergey@gmail.com';
	let DELAY_BEFORE_DB_CLEANUP = 60 * 1000;
	let DELAY_BEFORE_DB_MIGRATE_TO_INDEXEDDB = 60 * 1000;
	let tickSize = 10;

	/* Debug */
	let debug = false;
	let debugInit = false;
	let debugScreenCache = false;
	const debugDBCleanup = true;

	/* Definitions for Syntax Check */
	window.chrome = window.chrome || {};
	window.FormRestoreController = window.FormRestoreController || {};
	window.HistoryOpenerController = window.HistoryOpenerController || {};
	window.isTabInIgnoreTabList = window.isTabInIgnoreTabList || {};
	window.parseUrlParam = window.parseUrlParam || {};
	window.getScreen = window.getScreen || {};
	window.BrowserActionControl = window.BrowserActionControl || {};
	window.getTabInfo = window.getTabInfo || {};
	window.localStorage = window.localStorage || {};
	window.isScreenExist = window.isScreenExist || {};
	window.extractHostname = window.extractHostname || {};
	window.isTabParked = window.isTabParked || {};
	window.isTabMarkedForUnsuspend = window.isTabMarkedForUnsuspend || {};
	window.hasLastError = window.hasLastError || {};
	window.addScreen = window.addScreen || {};
	window.WhiteList = window.WhiteList || {};
	window.versionCompare = window.versionCompare || {};
	window.ADDED_ON_INDEX_NAME = window.ADDED_ON_INDEX_NAME || {};
	window.trackView = window.trackView || {};
	window.trackErrors = window.trackErrors || {};
	window.DBProvider = window.DBProvider || {};
	window.Store = window.Store || {};


	function createNewTabInfo(tab) {
		return {
			'id': tab.id,
			'winId': tab.windowId,
			'idx': tab.index,
			'time': 0,
			'suspended_time': 0,
			'active_time': 0,
			'swch_cnt': 0,
			'parkTrys': 0,
			'lstCapUrl': tab.url,
			'lstCapTime': null,
			'lstSwchTime': null,
			'v': 2,
			'suspendPercent': 0,
			'discarded': tab.discarded,
			'markedForDiscard': false,
			'parkedCount': 0,
			'parkedUrl': null,
			'nonCmpltInput': false,
			'refreshIconRetries': 0
		};
	}

	let c5 = chrome;
	let t5 = c5.tabs;
	let e5 = c5.extension;
	let r5 = c5.runtime;

	let extUrl;

	// Globals
	let rootExtensionUri = e5.getURL('');
	let sessionsPageUrl = e5.getURL('sessions.html');
	let database;
	let webSqlDatabase;
	let tabs = {}; // list of tabIDs with inactivity time {'id', 'time', 'active_time', 'swch_cnt', 'screen', 'parkTrys'}
	let HISTORY_KEEP_LAST_N_ITEMS = 300;
	let parkHistory = [];
	let closeHistory = [];
	window.tabScreens = {}; // map of tabIDs with last 'screen'
	let ignoreTabList = {};
	let ticker = null;
	let tickCount = 0;
	let settings = {};
	let debugTabsInfo = false;
	let whiteList;
	let globalMenuIdMap;
	let pauseTics = 0;
	let pauseTicsStartedFrom = 0;
	let isCharging = true;
	let startedAt = new Date().getTime();
	let firstTimeTabDiscardMap = {};
	let screenshotQuality;
	// eslint-disable-next-line no-undef
	let formRestoreController = new FormRestoreController();
	// eslint-disable-next-line no-undef
	let tabsMarkedForUnsuspend = [];
	let TABS_MARKED_FOR_UNSUSPEND_TTL = 5000;
	// eslint-disable-next-line no-undef
	let historyOpenerController = new HistoryOpenerController();
	let batteryLevel = -1.0;
	let dbMovedFromWebSqlToIndexedDB = false;
	let getScreenCache = null;
	let wizardPageUrl = e5.getURL('wizard_background.html');
	let settingsInitedResolve, settingsInitedPromise = new Promise(function(resolve) {
		settingsInitedResolve = resolve;
	});
	let lastWindowDevicePixelRatio = {};

	let settingsStorageNamespace = 'tabSuspenderSettings'; /* Also has duplicats in fancy-settings/../settings.js */

	window.popupQuery = function(tab) {
		if (debug)
			console.log('popupQuery Requested.');

		let tabURLAllowedForPark = isTabURLAllowedForPark(tab);
		let parked;
		try {
			parked = tabs[tab.id].parked;
			// eslint-disable-next-line no-empty
		} catch (e) {
		}

		if (debug)
			console.log('Park alowed: ' + tabURLAllowedForPark, 'parked: ', parked == true, tab);

		return {
			successful: true,
			tabId: tab.id,
			allowed: tabURLAllowedForPark,

			active: settings.get('active'),
			timeout: settings.get('timeout'),
			parked: parked == true,
			pauseTics: pauseTics,
			pauseTicsStartedFrom:
			pauseTicsStartedFrom,
			// eslint-disable-next-line no-undef
			isTabInIgnoreTabList: isTabInIgnoreTabList(tab.id),
			// eslint-disable-next-line no-undef
			isTabInWhiteList: (parked ? whiteList.isURIException(parseUrlParam(tab.url, 'url')) : whiteList.isURIException(tab.url)),
			isCloseTabsOn: settings.get('isCloseTabsOn'),
			closeTimeout: settings.get('closeTimeout'),
			limitOfOpenedTabs: settings.get('limitOfOpenedTabs'),
			TSVersion: chrome.runtime.getManifest().version,
			sendErrors: settings.get('sendErrors'),
			popup_showWindowSessionByDefault: settings.get('popup_showWindowSessionByDefault'),
		};
	};

	window.addScreen = function(id, screen, devicePixelRatio) {
		'use strict';

		if (screen != null) {
			if (devicePixelRatio == null) {
				console.debug('addScreen(): devicePixelRatio is null!!!');
			}

			const metadata =
				{
					'id': parseInt(id),
					'sessionId': window.TSSessionId,
					'added_on': new Date(),
					'screen': screen,
					'pixRat': devicePixelRatio
				};

			database.putV2([
					{
						IDB:
							{
								table: 'screens',
								data: metadata
							}
					}/*,
					{
						IDB:
							{
								table: SCREENS_BINARY_DB_NAME,
								key: parseInt(id) + '|' + window.TSSessionId,
								data: atob(screen.substr(23))
							}
					}*/
				]
			);
		}
	};

	window.getScreen = function(id, sessionId, callback) {
		'use strict';

		if (debugScreenCache)
			console.log('getScreen called for tabId: ' + id, Date.now());

		if (database.isInitialized() != true) {
			console.log('getScreen DB is not initialized yet waiting...: ' + id, Date.now());
			database.getInitializedPromise().then(function() {
				// eslint-disable-next-line no-undef
				getScreen(id, sessionId, callback);
			});
			return;
		}

		if (sessionId == null)
			sessionId = window.TSSessionId;

		if (getScreenCache != null) {
			if (getScreenCache.sessionId == sessionId && getScreenCache.tabId == id) {
				getScreenCache.getScreenPromise.then(function() {
					if (debugScreenCache)
						console.log('getScreen then handler added');
					callback(getScreenCache.screen, getScreenCache.pixRat);
					getScreenCache = null;
					if (debugScreenCache)
						console.log('Screen got from cache!!');
				});
				return;
			} else
				getScreenCache = null;
		}

		let currentDB;
		if (dbMovedFromWebSqlToIndexedDB == true || isCurrentSessionAfter(sessionId))
			currentDB = database;
		else
			currentDB = webSqlDatabase;

		currentDB.queryIndex(
			{
				IDB:
					{
						table: 'screens',
						index: 'PK'
					},
				WebSQL:
					{
						/*query: 'select screen from screens where id = ? and sessionId = ?'*/
					},
				params: [parseInt(id), parseInt(sessionId)]
			},
			function(fields) {
				if (fields == null) {
					callback(null);
					return;
				}

				if (debugScreenCache)
					console.log('getScreen result: ', Date.now());
				callback(fields['screen'], fields['pixRat'] || 1);
			}
		);
	};

	function isCurrentSessionAfter(timestamp) {
		if (parseInt(timestamp) >= parseInt(window.TSSessionId))
			return true;
		return false;
	}

	window.isScreenExist = function(id, sessionId, callback) {
		'use strict';

		if (sessionId == null)
			sessionId = window.TSSessionId;

		let currentDB;
		if (dbMovedFromWebSqlToIndexedDB == true)
			currentDB = database;
		else
			currentDB = webSqlDatabase;

		currentDB.queryIndexCount(
			{
				IDB:
					{
						table: 'screens',
						index: 'PK'
					},
				WebSQL:
					{
						query: 'select count(*) from screens where id = ? and sessionId = ?'
					},
				params: [parseInt(id), parseInt(sessionId)]
			},
			callback
		);
	};

	window.getRestoreEvent = function() {
		'use strict';

		return (settings.get('restoreOnMouseHover') == true ? 'hover' : 'click');
	};

	window.getReloadTabOnRestore = function() {
		'use strict';

		return settings.get('reloadTabOnRestore');
	};

	window.getTabIconStatusVisualize = function() {
		'use strict';

		return settings.get('tabIconStatusVisualize');
	};

	window.getTabIconOpacityChange = function() {
		'use strict';

		return settings.get('tabIconOpacityChange');
	};

	window.getRestoreButtonView = function() {
		'use strict';

		return settings.get('restoreButtonView');
	};

	window.getScreenshotCssStyle = function() {
		'use strict';

		return settings.get('screenshotCssStyle');
	};

	window.getStartDiscarted = function() {
		'use strict';

		return settings.get('startDiscarted');
	};

	window.isFirstTimeTabDiscard = function(tabId) {
		let isFirstTime = !(tabId in firstTimeTabDiscardMap);
		firstTimeTabDiscardMap[tabId] = true;
		return isFirstTime;
	};

	window.getParkBgColor = function() {
		'use strict';
		let color = settings.get('parkBgColor');
		if (color != null && color.search(/^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) >= 0)
			return color;
		else
			return window.DEFAULT_SETTINGS.parkBgColor;
	};

	function addToIgnoreTabList(tabId) {
		'use strict';

		ignoreTabList[tabId] = true;

		new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	window.isTabInIgnoreTabList = function(tabId) {
		'use strict';

		return ignoreTabList[tabId] != null;
	};

	window.getStartedAt = function() {
		'use strict';

		return startedAt;
	};

	window.isTabMarkedForUnsuspend = function(tabIdStr, sessionIdStr, options) {
		'use strict';

		if (tabsMarkedForUnsuspend.length <= 0)
			return false;

		let now = Date.now();
		let tabId = parseInt(tabIdStr);
		let sessionId = parseInt(sessionIdStr);
		for (let i = 0; i < tabsMarkedForUnsuspend.length; i++)
			if (now - tabsMarkedForUnsuspend[i].at <= TABS_MARKED_FOR_UNSUSPEND_TTL && tabsMarkedForUnsuspend[i].tabId == tabId && tabsMarkedForUnsuspend[i].sessionId == sessionId) {
				if (options && options.remove) {
					tabsMarkedForUnsuspend.splice(i, 1);
				}
				return true;
			}
		return false;
	};

	window.getTabInfo = function(tab) {
		let tabInfo = tabs[tab.id];

		if (tabInfo == null)
			tabs[tab.id] = tabInfo = createNewTabInfo(tab);

		return tabInfo;
	};

	function removeFromIgnoreTabList(tabId) {
		'use strict';

		delete ignoreTabList[tabId];

		new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	function isTabURLAllowedForPark(tab) {
		'use strict';

		return (tab.url.substring(0, tab.url.indexOf(':')) == 'http' ||
			tab.url.substring(0, tab.url.indexOf(':')) == 'https' ||
			tab.url === wizardPageUrl);
	}


	function passGroupedTabsRules(tab, ignoreCloseGroupedTabs) {
		return tab.groupId === -1 || (tab.groupId !== -1 && !ignoreCloseGroupedTabs);
	}

	function isExceptionTab(tab) {
		'use strict';

		try {
			return isTabExceprion(tab) || whiteList.isURIException(tab.url);
		} catch (ex) {
			console.error(ex);
			return isTabExceprion(tab);
		}
	}

	function isTabExceprion(tab) {
		// Audiable
		if (isAudiable(tab) && settings.get('ignoreAudible'))
			return true;

		// Pinned Tab
		if (tab.pinned == true && settings.get('pinned'))
			return true;

		//Tab Ignore List
		// eslint-disable-next-line no-undef
		if (isTabInIgnoreTabList(tab.id))
			return true;

		// Not complete input
		// eslint-disable-next-line no-undef
		if (getTabInfo(tab).nonCmpltInput)
			return true;

		return false;
	}

	function isAudiable(tab) {
		return (typeof tab.audible == 'boolean' && tab.audible == true);
	}

	function parkTabs(requestTab, windowId) {
		let callbackSingle = function(window) {
			let number = 0;
			for (let j in window.tabs)
				if (window.tabs.hasOwnProperty(j))
					if (requestTab == null || (requestTab != null && windowId != null) || window.tabs[j].id != requestTab.id)
						if (isTabURLAllowedForPark(window.tabs[j]))
							if (!isExceptionTab(window.tabs[j]))
								parkTab(window.tabs[j], window.tabs[j].id, { bulkNumber: (window.tabs[j].discarded ? number++ : null) });
		};

		let callbackAll = function(windows) {
			for (let wi in windows)
				if (windows.hasOwnProperty(wi))
					callbackSingle(windows[wi]);
		};

		if (windowId != null)
			c5.windows.get(windowId, { 'populate': true }, callbackSingle);
		else
			c5.windows.getAll({ 'populate': true }, callbackAll);
	}

	// park idle tab if it is not parked yet
	function parkTab(tab, tabId, options) {
		'use strict';

		if (!isTabURLAllowedForPark(tab))
			return;

		if (tab.discarded && (options == null || options.reloaded == false)) {
			t5.reload(tabId, function() {
				setTimeout(function() {
					parkTab(tab, tabId, { reloaded: true });
				}, (options != null && options.bulkNumber > 0 ? options.bulkNumber * 1000 : 1000));
			});
			return;
		}

		/* Save history */
		try {
			let duplicate = false;
			if (parkHistory.length > 0 && parkHistory[0].tabId != null && parkHistory[0].sessionId != null)
				if (parkHistory[0].tabId == tabId && parkHistory[0].sessionId == window.TSSessionId)
					duplicate = true;
			if (!duplicate) {
				parkHistory.splice(0, 0, {
					timestamp: (new Date()).getTime(),
					url: tab.url,
					title: tab.title,
					tabId: tabId,
					sessionId: window.TSSessionId
				});
				parkHistory.splice(HISTORY_KEEP_LAST_N_ITEMS);
				localStorage.setItem('parkHistory', JSON.stringify(parkHistory));
			}

			formRestoreController.hebernateFormData(tabId);
		} catch (e) {
			console.error(e);
		}

		/* Detached from thread for hebernateFormData have chance to process */
		setTimeout(function() {
			isScreenExist(tabId, null, function(screenExist) {
				if (screenExist == null || parseInt(screenExist) <= 0) {
					if (debug)
						console.log('Screen Not Exist');

					getTabInfo(tab).lstCapUrl = tab.url;

					let tabParked = false;
					let closureTabId = tabId;
					let closureTab = tab;
					let checkTabIsParked;
					let checkTabIsParkedTimeout;

					let parkByMessage = function(closureTab, closureTabId) {
						c5.windows.get(closureTab.windowId, function(win) {
							let width = null;
							if (closureTab.width == null || closureTab.width == 0)
								width = win.width - 20;
							let height = win.height;

							t5.sendMessage(closureTabId, {
									method: '[AutomaticTabCleaner:ParkPageFromInject]',
									'tabId': closureTab.id,
									'sessionId': window.TSSessionId,
									'width': width,
									'height': height
								},
								function(response) {
									if (response != null) {
										if (response.result == 'successful') {
											tabParked = true;
											markTabParked(closureTab);
										} else if (checkTabIsParked != null)
											checkTabIsParked();
									}
									console.log('ParkPageFromInject response: ' + response);
								});
						});
					};

					parkByMessage(closureTab, closureTabId);

					/*	TODO:	Invesigate https://yandex.ru/maps/2/saint-petersburg/?ll=30.414844%2C60.004372&z=12&mode=search&text=molly&sll=30.414844%2C60.004372&sspn=0.372849%2C0.003782&sctx=ZAAAAAgBEAAaKAoSCVnaqbncUD5AEQZwqwdp901AEhIJwSUCAMDc5z8ROPBhbOXJyz8gACABIAIgAygFMAE4%2BYuinpTW%2BYw1QL2CBkgBVcH%2Bfz9YAGIjZGlyZWN0X2RvbnRfc2hvd19vbl9jaGFpbl9yZXF1ZXN0PTFiKGRpcmVjdF9kb250X3Nob3dfb25fcnVicmljX3dpdGhfYWR2ZXJ0PTFqAnJ1cAA%3D					*/
					/*  DOMException: Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported. */
					/*  Try to reinject JS if parked failed */
					/*								*/
					checkTabIsParkedTimeout = setTimeout(checkTabIsParked = function() {
						if (checkTabIsParkedTimeout != null) {
							clearTimeout(checkTabIsParkedTimeout);
							checkTabIsParkedTimeout = null;
						}

						if (tabParked == false/* && isPageHasNonCompleteInput == false*/) {
							injectJS(closureTabId);
							parkByMessage(closureTab, closureTabId);
						}
					}, 10000);
				} else
					try {
						if (debug)
							console.log('Screen Exist');

						//check if parked
						if (tab != null /*&& !tab.active && isTabURLAllowedForPark(tab)*/) {
							t5.sendMessage(tabId, { method: '[AutomaticTabCleaner:getOriginalFaviconUrl]' }, function(originalFaviconUrl) {

								if (debug)
									console.log('originalFaviconUrl: ', originalFaviconUrl);

								let url = extUrl + '?title=' + encodeURIComponent(tab.title);
								url += '&url=' + encodeURIComponent(tab.url);
								url += '&tabId=' + encodeURIComponent(tabId);
								url += '&sessionId=' + encodeURIComponent(window.TSSessionId);

								if (originalFaviconUrl != null && originalFaviconUrl != '')
									url += '&icon=' + encodeURIComponent(originalFaviconUrl);
								else if (tab.favIconUrl)
									url += '&icon=' + encodeURIComponent(tab.favIconUrl);

								t5.update(tab.id, { 'url': url });
							});
						}

						markTabParked(tab);
					} catch (e) {
						console.error('Park by link failed: ', e);
					}
			});
		}, 200);
	}

	function markTabParked(tab) {
		if (getTabInfo(tab).parkedUrl != null) {
			if (extractHostname(getTabInfo(tab).parkedUrl) == extractHostname(getTabInfo(tab).lstCapUrl))
				getTabInfo(tab).parkedCount += 1;
			else
				getTabInfo(tab).parkedCount = 0;
		} else
			getTabInfo(tab).parkedCount += 1;

		if (tab.url.indexOf(extUrl) == 0)
			getTabInfo(tab).parkedUrl = getParameterByName('url', tab.url); //getTabInfo(tab).lstCapUrl;
		else
			getTabInfo(tab).parkedUrl = tab.url;

		getTabInfo(tab).parked = true;
	}

	function unsuspendTabs(windowId) {
		'use strict';

		let openedIndex = 1;

		let callbackSingle = function(window) {
			'use strict';

			for (let j in window.tabs)
				if (window.tabs.hasOwnProperty(j))
					if (isTabParked(window.tabs[j])) {
						let tmpFunction = function(j) {
							let tab = window.tabs[j];
							let clzOpenedIndex = openedIndex++;
							setTimeout(function() {
								unsuspendTab(tab);
							}, 1000 * clzOpenedIndex);
						};

						tmpFunction(j);
					}
		};

		let callbackAll = function(windows) {
			'use strict';

			for (let wi in windows)
				if (windows.hasOwnProperty(wi))
					callbackSingle(windows[wi]);
		};


		if (windowId != null)
			c5.windows.get(windowId, { 'populate': true }, callbackSingle);
		else
			c5.windows.getAll({ 'populate': true }, callbackAll);
	}

	function unsuspendTab(tab) {
		if (tab.discarded == true) {
			markForUnsuspend(tab);
			t5.reload(tab.id, function() {
			});
		} else {
			if (tab.status == 'loading') {
				if (settings.get('reloadTabOnRestore') == true)
					t5.update(tab.id, { 'url': parseUrlParam(tab.url, 'url') });
				else {
					markForUnsuspend(tab);
				}
			} else
				_unsuspendTab(tab);
		}
	}

	function markForUnsuspend(tab) {
		let o = {
			tabId: parseInt(parseUrlParam(tab.url, 'tabId')),
			sessionId: parseInt(parseUrlParam(tab.url, 'sessionId')),
			at: Date.now()
		};
		tabsMarkedForUnsuspend.push(o);

		/* CLEANUP tabsMarkedForUnsuspend */
		let now = Date.now();
		for (let i = 0; i < tabsMarkedForUnsuspend.length; i++) {
			if (now - tabsMarkedForUnsuspend[i].at > TABS_MARKED_FOR_UNSUSPEND_TTL) {
				tabsMarkedForUnsuspend.splice(i, 1);
				i--; // Prevent skipping an item
			}
		}
	}

	function _unsuspendTab(tab) {
		'use strict';

		r5.sendMessage({ 'method': '[AutomaticTabCleaner:RestoreMessage]', 'tab': tab });
	}

	function closeTab(tabId, tab) {
		/* Save history */
		try {
			closeHistory.splice(0, 0, {
				timestamp: (new Date()).getTime(),
				url: tab.url,
				title: tab.title,
				tabId: parseUrlParam(tab.url, 'tabId'),
				sessionId: parseUrlParam(tab.url, 'sessionId')
			});
			closeHistory.splice(HISTORY_KEEP_LAST_N_ITEMS);
			localStorage.setItem('closeHistory', JSON.stringify(closeHistory));

			reloadHistoryPage();
		} catch (e) {
			console.error(e);
		}

		t5.remove(tabId, null);
	}

	const checkAndTurnOffAutoDiscardable = (tab) => {
		if (tab.autoDiscardable === true)
			t5.update(tab.id, { autoDiscardable: false });
	};

	// simple timer - update inactivity time, unload timeouted tabs
	function tick(stateOnly) {
		'use strict';

		navigator.getBattery().then(function(battery) {

			if (battery != null && battery.level != null && battery.level >= 0.0)
				batteryLevel = battery.level;
		});

		if (!stateOnly) {
			tickCount += tickSize;

			if (pauseTics > 0) {
				pauseTics -= tickSize;
				if (pauseTics <= 0) {
					new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
					pauseTicsStartedFrom = 0;
				}
				return;
			}
		}

		let pinnedSettings = settings.get('pinned');
		let timeoutSettings = settings.get('timeout');
		let closeTimeout = settings.get('closeTimeout');
		let isCloseTabsOn = settings.get('isCloseTabsOn');
		let ignoreAudible = settings.get('ignoreAudible');
		let animateTabIconSuspendTimeout = settings.get('animateTabIconSuspendTimeout');
		let autoSuspendOnlyOnBatteryOnly = settings.get('autoSuspendOnlyOnBatteryOnly');
		let discardTabAfterSuspendWithTimeout = settings.get('discardTabAfterSuspendWithTimeout');
		let discardTimeoutFactor = settings.get('discardTimeoutFactor');
		let enableSuspendOnlyIfBattLvlLessValue = settings.get('enableSuspendOnlyIfBattLvlLessValue');
		let battLvlLessValue = settings.get('battLvlLessValue');
		let adaptiveSuspendTimeout = settings.get('adaptiveSuspendTimeout');

		if (batteryLevel < 0.0)
			enableSuspendOnlyIfBattLvlLessValue = false;


		let cleanedTabsArray = {};

		c5.windows.getAll({ 'populate': true }, function(windows) {

			// CLOSE TAB LOGIC
			if (!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging)
				if (isCloseTabsOn && tickCount % tickSize == 0) {
					let ignoreCloseGroupedTabs = settings.get('ignoreCloseGroupedTabs');

					let oneTabClosed = false;
					for (let wi in windows) {
						let tabArray = [];

						let tab;
						let tabFromTabs;
						if (windows.hasOwnProperty(wi))
							for (let j in windows[wi].tabs)
								if (windows[wi].tabs.hasOwnProperty(j)) {
									tab = windows[wi].tabs[j];
									tabFromTabs = tabs[tab.id];
									if (tabFromTabs) {
										if (!isExceptionTab(tab) && passGroupedTabsRules(tab, ignoreCloseGroupedTabs))
											tabArray.push(tabFromTabs);
									}
								}

						let minRank = 19999999999;
						let minRankTab;
						if (tabArray.length > settings.get('limitOfOpenedTabs')) {
							for (let i = 0; i < tabArray.length; i++) {
								tab = tabArray[i];
								if (tab.time >= closeTimeout) {
									let currentRank = tab.active_time * tab.active_time * (tab.swch_cnt + 1) - tab.time * (tab.parked ? tab.time : 2);
									if (minRank > currentRank) {
										minRank = currentRank;
										minRankTab = tab;
									}
									if (debug)
										console.log(currentRank, ' : ', tab);
								}
							}
						}

						if (minRankTab != null) {
							let tabToClose = null;
							if ((tabToClose = tabExist(windows, minRankTab.id)) != null) {
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

			let steps = 10;
			let oneTabParked = false;
			let refreshIconIndex = 0;

			// SUSPEND TAB LOGIC
			// eslint-disable-next-line no-redeclare
			let tab;
			let tabId;
			for (let i in windows) {
				if (windows.hasOwnProperty(i)) {
					// eslint-disable-next-line no-redeclare
					for (let j in windows[i].tabs) {
						if (windows[i].tabs.hasOwnProperty(j)) {

							tab = windows[i].tabs[j];
							tabId = tab.id;

							try {
								if (debugTabsInfo)
									console.log(i, j, tab);
								// eslint-disable-next-line no-empty
							} catch (e) {
							}


							checkAndTurnOffAutoDiscardable(tab);

							let tabInfo = null;

							if (!tabs.hasOwnProperty(tabId)) {
								tabInfo = createNewTabInfo(tab);
								tabs[tabId] = tabInfo;
							} else
								tabInfo = tabs[tabId];

							cleanedTabsArray[tabId] = tabInfo;


							{
								let isTabParked = tab.url != null && tab.url.indexOf(extUrl) == 0;

								/* Restore session logic When uninstall */

								if (!stateOnly) {
									tabInfo.time += tickSize;

									if (isTabParked)
										tabInfo.suspended_time += tickSize;
								}

								if (!oneTabParked /*&& tickCount % 5 == 0*/) {
									if (tabInfo.parkedCount == null)
										tabInfo.parkedCount = 0;

									let calculatedTabTimeFrame = timeoutSettings + timeoutSettings * tabInfo.parkedCount + (tabInfo.active_time + 1) * Math.log2(tabInfo.swch_cnt + 1) + (timeoutSettings / 4) * Math.log2(tabInfo.swch_cnt + 1);

									if (extUrl !== 'chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/park.html')
										chrome.browserAction.setBadgeText({
											text: '' + Math.round((calculatedTabTimeFrame - tabInfo.time) / 60) + '|' + tabInfo.swch_cnt,
											tabId: tabId
										});

									if (!adaptiveSuspendTimeout && tabInfo.time >= timeoutSettings
										|| adaptiveSuspendTimeout && tabInfo.time >= calculatedTabTimeFrame) {
										if (!tab.active &&
											tab.status === 'complete' &&
											isTabURLAllowedForPark(tab) &&
											tabInfo.parkTrys <= 2) {
											if (!isExceptionTab(tab)) {
												if (!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging) {
													if (enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue / 100 && !isCharging) {
														if (!stateOnly) {
															parkTab(tab, tabId);
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
												!isExceptionTab(tab) &&
												isTabURLAllowedForPark(tab) &&
												(!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging) &&
												(enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue / 100 && !isCharging)) {
												let step = Math.round(tabInfo.time / ((timeoutSettings + timeoutSettings * (2 / steps)) / steps));
												let suspendPercent = step * 10;
												if (tabInfo.suspendPercent != suspendPercent) {
													tabInfo.suspendPercent = suspendPercent;
													t5.sendMessage(tabId, {
														method: '[AutomaticTabCleaner:highliteFavicon]',
														highliteInfo: { suspendPercent: suspendPercent }
													});
												}
											}
									}
								}

								/* PINNED TABS */
								if (ignoreAudible && isAudiable(tab))
									tabInfo.time = 0;

								/* DISCARD TABS */
								if (isTabParked) {
									tabInfo.discarded = tab.discarded;

									/* Refresh susp. tab empty icons */
									if ((tab.favIconUrl == null || tab.favIconUrl === '') && tabInfo.refreshIconRetries < 2) {
										tabInfo.refreshIconRetries = tabInfo.refreshIconRetries + 1;
										let tmpFunction = function(id, discard, index) {
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
														console.log('Disacrd failed: ', tab);
													}

													tabInfo.discarded = true;
												}
											}
										}
								}

								/* DEBUG INFO */
								if (debug) {
									if (isTabURLAllowedForPark(tab) && tab.discarded == false) {
										try {
											t5.executeScript(tabId, { code: 'document.title = \'' + appendTitleDebug(tab.title, tabInfo) + '\'' });
											// eslint-disable-next-line no-empty
										} catch (e) {
										}
									}
								}
							}

							if (!stateOnly) {
								/*																			*/
								/* !!!!!!! LOOKS LIKE DEAD CODE !!!!!!! */
								/*																			*/
								if (tab.active) {
									if (tabs[tabId] != null) {
										tabs[tabId].time = 0;
										tabs[tabId].active_time += tickSize * (isAudiable(tab) ? 1.5 : 1);
										tabs[tabId].suspended_time = 0;
										tabs[tabId].parkTrys = 0;
									}
								}
								if (pinnedSettings && tab.pinned)
									tabs[tabId].time = 0;
							}
						}
					}
				}
			}

			tabs = cleanedTabsArray;

		});
	}

	function discardTab(tabId) {
		t5.discard(tabId, function() {
			hasLastError();
		});
	}

	function captureTab(tab, options) {
		'use strict';

		if (options == null || options.checkActiveTabNotChanged != true)
			_captureTab(tab);
		else {
			t5.get(tab.id, function(tab) {
				if (hasLastError())
					return;

				if (tab != null)
					_captureTab(tab);
			});
		}
	}

	function _captureTab(tab) {
		'use strict';
		return new Promise(function(resolve, reject) {
			try {
				let id = tab.id;
				if (tab.active === true) {
					if (!tabs.hasOwnProperty(id))
						tabs[id] = createNewTabInfo(tab);

					if (tab.status != null && tab.status !== 'loading')
						try {
							t5.captureVisibleTab(tab.windowId, {
								format: 'jpeg',
								quality: screenshotQuality
							}, function(screen) {

								if (hasLastError('The \'activeTab\' permission is not in effect because this extension has not been in invoked.',
									/*'Cannot access contents of url "". Extension manifest must request permission to access this host.',
                                    'Cannot access contents of url "file:///". Extension manifest must request permission to access this host.',
                                    'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',*/
									'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
									'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab',
									'RegExp:Cannot access contents of url "' + rootExtensionUri + '.*',
									'RegExp:No window with id: \\d{1,5}\\.',
									'Failed to capture tab: view is invisible',
									'No active web contents to capture')) {
									try {
										reject();
										return;
										// eslint-disable-next-line no-empty
									} catch (e) {
									}
									return;
								}

								if (screen === 'data:,')
									console.error(new Error('Damaged screen [data:,]!!! id:', id));


								chrome.tabs.executeScript(id, { code: 'window.devicePixelRatio' },
									function(devicePixelRatio) {
										if (devicePixelRatio == null)
											devicePixelRatio = lastWindowDevicePixelRatio[tab.windowId];
										else
											lastWindowDevicePixelRatio[tab.windowId] = devicePixelRatio = devicePixelRatio[0];

										try {
											addScreen(id, screen, devicePixelRatio);
											tabs[id].lstCapUrl = tab.url;
											tabs[id].lstCapTime = Date.now();

											resolve();
											// eslint-disable-next-line no-empty
										} catch (e) {
										}
									});
							});
						} catch (e) {
							// normal behavior
						}

					return;
				}
			} catch (e) {
				console.error(e);
			}
		});
	}

	function appendTitleDebug(title, tabInfo) {
		'use strict';

		let indexOfDebufInfoStart = title.indexOf('^');
		if (indexOfDebufInfoStart == -1)
			return debugInfoString(tabInfo) + ' ^ ' + title;
		else
			return debugInfoString(tabInfo) + title.substring(indexOfDebufInfoStart);
	}

	function debugInfoString(tabInfo) {
		return '[' + tabInfo.time + '][' + tabInfo.active_time + '][' + tabInfo.suspended_time + ']';
	}

	r5.onMessage.addListener(function(request, sender, sendResponse) {
		'use strict';

		if (request.method === '[AutomaticTabCleaner:trackError]') {
			let error = Error(request.message);
			error.stack = request.stack;
			console.error('[External]: ' + request.message, error);
		} else if (request.method === '[AutomaticTabCleaner:GetTabId]') {
			sendResponse(sender.tab.id);
		} else if (request.method === '[AutomaticTabCleaner:ParkPageFromInjectFinished]') {
			t5.update(request.tabId, { 'url': request.url });

			if (tabs[request.tabId] != null)
				tabs[request.tabId].parked = true;
		}
		/* Сase when screen moved from inject side */
		else if (typeof request == 'string') {
			let sep = request.indexOf('/');
			let screen = request.substr(sep + 1);
			if (screen === 'data:,')
				console.error(new Error('Damaged screen [data:,]!!! id:', request.substr(0, sep)));

			addScreen(/*id*/request.substr(0, sep), /*screen*/screen, 1); //tabs[request.tab.id].screen = request.screen;
		} else if (request.method === '[AutomaticTabCleaner:addExceptionPatterns]') {/* DEPREACTED! */
			if (debug)
				console.log('AddExceptionPatterns info Requested.');
			settings.set('exceptionPatterns', settings.get('exceptionPatterns') + '\n' + request.pattern);
			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:suspendTab]') {
			if (debug)
				console.log('suspendTab Requested.');
			if (isTabURLAllowedForPark(request.tab) /*&& !isExceptionTab(request.tab)*/) {
				if (debug)
					console.log('Park alowed: ', request.tab);

				parkTab(request.tab, request.tab.id);

				sendResponse({ successful: true });
			} else {
				if (debug)
					console.log('Park disalowed: ', request.tab);
				sendResponse({ successful: true });
			}
		} else if (request.method === '[AutomaticTabCleaner:suspendWindow]') {
			parkTabs(request.tab, request.tab.windowId);
			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:suspendAllOtherTabs]') {
			if (debug)
				console.log('suspendAllOtherTabs Requested.');

			parkTabs(request.tab);

			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:suspendAllTabs]') {
			if (debug)
				console.log('suspendAllTabs Requested.');

			parkTabs();

			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:unsuspendAllTabs]') {
			if (debug)
				console.log('unsuspendAllTabs Requested.');

			unsuspendTabs();

			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:unsuspendWindow]') {
			unsuspendTabs(request.tab.windowId);
			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:unsuspendTab]') {
			unsuspendTab(request.tab);
			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:pause]') {
			if (debug)
				console.log('pause Requested.');

			pauseTics = request.pauseTics;
			pauseTicsStartedFrom = request.pauseTics;

			new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();

			sendResponse({ successful: true, pauseTics: pauseTics });
		} else if (request.method === '[AutomaticTabCleaner:ignoreTab]') {
			if (debug)
				console.log('ignoreTab Requested.');

			if (request.action == 'add')
				addToIgnoreTabList(request.tabId);
			else if (request.action === 'remove')
				removeFromIgnoreTabList(request.tabId);

			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:popupQuery]') {
			if (debug)
				console.log('popupQuery Requested.');

			let tabURLAllowedForPark = isTabURLAllowedForPark(request.tab);
			let parked;
			try {
				parked = tabs[request.tab.id].parked;
				// eslint-disable-next-line no-empty
			} catch (e) {
			}

			if (debug)
				console.log('Park alowed: ' + tabURLAllowedForPark, 'parked: ', parked == true, request.tab);
			sendResponse({
				successful: true,
				allowed: tabURLAllowedForPark,
				timeout: settings.get('timeout'),
				parked: parked == true,
				pauseTics: pauseTics,
				pauseTicsStartedFrom:
				pauseTicsStartedFrom,
				isTabInIgnoreTabList: isTabInIgnoreTabList(request.tab.id),
				isTabInWhiteList: whiteList.isURIException(request.tab.url),
				isCloseTabsOn: settings.get('isCloseTabsOn'),
				closeTimeout: settings.get('closeTimeout'),
				limitOfOpenedTabs: settings.get('limitOfOpenedTabs')
			});
		} else if (request.method === '[AutomaticTabCleaner:updateTimeout]') {
			if (request.isTabSuspenderActive != null)
				settings.set('active', request.isTabSuspenderActive);
			else if (request.timeout != null && typeof request.timeout == 'number')
				settings.set('timeout', request.timeout);
			else if (request.isCloseTabsOn != null)
				settings.set('isCloseTabsOn', request.isCloseTabsOn);
			else if (request.closeTimeout != null && typeof request.closeTimeout == 'number')
				settings.set('closeTimeout', request.closeTimeout);
			else if (request.limitOfOpenedTabs != null && typeof request.limitOfOpenedTabs == 'number')
				settings.set('limitOfOpenedTabs', request.limitOfOpenedTabs);
			else if (request.sendErrors != null)
				settings.set('sendErrors', request.sendErrors);
			else if (request.popup_showWindowSessionByDefault != null)
				settings.set('popup_showWindowSessionByDefault', request.popup_showWindowSessionByDefault);

			reloadSettings();

			sendResponse({ successful: true });
		} else if (request.method === '[AutomaticTabCleaner:uriExceptionCheck]') {
			sendResponse({ isException: whiteList.isURIException(request.uri) });
		} else if (request.method === '[AutomaticTabCleaner:TabChangedRequestFromInject]') {
			captureTab(sender.tab);
		} else if (request.method === '[AutomaticTabCleaner:TabUnsuspended]') {
			getTabInfo(sender.tab).time = 0; //tabs[sender.tab.id].time = 0;
			getTabInfo(sender.tab).suspended_time = 0; //tabs[sender.tab.id].suspended_time = 0;
			getTabInfo(sender.tab).parkTrys = 0;
			formRestoreController.expectRestore(sender.tab.id, request.targetTabId, request.url);
		} else if (request.method === '[AutomaticTabCleaner:getParkHistory]') {
			sendResponse({ parkHistory: parkHistory, closeHistory: closeHistory });
		} else if (request.method === '[AutomaticTabCleaner:hideDialog]') {
			hideWhiteListDialod(sender.tab.id);
			sendResponse({ tabId: sender.tab.id });
		} else if (request.method === '[AutomaticTabCleaner:installed]') {
			settings.set(INSTALLED, true);
		} else if (request.method === '[AutomaticTabCleaner:addToWhiteList]') {
			whiteList.addPattern(request.pattern);
			if (request.hideDialog === true)
				hideWhiteListDialod(sender.tab.id, { goBack: true });
			reloadSettings();

			setTimeout(function() {
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
			}, 500);

			sendResponse({ tabId: sender.tab.id });

		} else if (request.method === '[AutomaticTabCleaner:removeUrlFromWhitelist]') {
			removeUrlFromWhitelist(request.url);
		} else if (request.method === '[AutomaticTabCleaner:donate]') {
			google.payments.inapp.buy({
				'parameters': { 'env': 'prod' },
				'sku': 'ts_user_donation_level_4',
				'success': console.log,
				'failure': console.log
			});
		} else if (request.method === '[AutomaticTabCleaner:getFormRestoreDataAndRemove]') {
			sendResponse(formRestoreController.getFormRestoreDataAndRemove(sender.tab.id));
		} else if (request.method === '[AutomaticTabCleaner:DiscardTab]') {
			discardTab(sender.tab.id);
		} else if (request.method === '[AutomaticTabCleaner:UnmarkPageAsNonCompleteInput]') {
			getTabInfo(sender.tab).nonCmpltInput = false;
		} else if (request.method === '[AutomaticTabCleaner:MarkPageAsNonCompleteInput]') {
			getTabInfo(sender.tab).nonCmpltInput = true;
		}
	});

	function removeUrlFromWhitelist(url) {
		if (url != null) {
			whiteList.removePatternsAffectUrl(url);
			reloadSettings();

			setTimeout(function() {
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
			}, 500);
		}
	}

	function hideWhiteListDialod(tabId, options) {
		t5.sendMessage(tabId, { method: '[AutomaticTabCleaner:hideDialogRequetToTab]', options: options });
	}

	function tabExist(windows, tabId) {
		'use strict';

		for (let i in windows)
			if (windows.hasOwnProperty(i))
				for (let j in windows[i].tabs)
					if (windows[i].tabs.hasOwnProperty(j))
						if (windows[i].tabs[j].id == tabId)
							return windows[i].tabs[j];
		return null;
	}

	function getTextWidth(text) {
		'use strict';

		let span = document.createElement('span');
		span.style.whiteSpace = 'nowrap';
		span.style.fontFamily = 'initial';
		span.style.fontSize = 'initial';
		span.textContent = text;
		document.getElementsByTagName('body')[0].appendChild(span);
		let offsetWidth = span.offsetWidth;
		span.remove();
		return offsetWidth;
	}

	function createSecondLevelMenu(menuId, commands, menuInfosArray) {
		'use strict';

		let idsMap = {};
		let commandMap = {};
		let menuSpaceWidth = getTextWidth('a a') - getTextWidth('aa');
		let maxMenuLen = 0;

		for (let j in menuInfosArray) {
			if (menuInfosArray[j].type == null || menuInfosArray[j].type !== 'hidden') {
				menuInfosArray[j]._width = getTextWidth(menuInfosArray[j].title);
				if (menuInfosArray[j]._width > maxMenuLen)
					maxMenuLen = menuInfosArray[j]._width;
			}
		}

		let constantSpaces = maxMenuLen * 0.33;

		// eslint-disable-next-line no-redeclare
		for (let j in menuInfosArray) {
			let missingSpaces = (maxMenuLen - menuInfosArray[j]._width) / menuSpaceWidth;

			for (let k = 0; k < missingSpaces; k++)
				menuInfosArray[j].title += ' ';

			// eslint-disable-next-line no-redeclare
			for (let k = 0; k < constantSpaces / menuSpaceWidth; k++)
				menuInfosArray[j].title += ' ';

			if (menuInfosArray[j]._command != null) {
				for (let i in commands) {
					if (commands[i] == null || commands[i].name == null)
						continue;

					if (commands[i].name == menuInfosArray[j]._command)
						menuInfosArray[j].title += commands[i].shortcut;
				}

				commandMap[menuInfosArray[j]._command] = menuInfosArray[j].onclick;

				delete menuInfosArray[j]['_command'];
			}

			if (menuInfosArray[j]._width != null)
				delete menuInfosArray[j]['_width'];

			if (menuInfosArray[j].type == null || menuInfosArray[j].type !== 'hidden') {
				let id = chrome.contextMenus.create(menuInfosArray[j]);

				if (menuInfosArray[j].id != null)
					idsMap[menuInfosArray[j].id] = id;
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

		return idsMap;
	}

	function getParameterByName(name, url) {
		'use strict';

		if (!url) url = window.location.href;
		// eslint-disable-next-line no-useless-escape
		name = name.replace(/[\[\]]/g, '\\$&');
		let regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
			results = regex.exec(url);
		if (!results) return null;
		if (!results[2]) return '';
		return decodeURIComponent(results[2].replace(/\+/g, ' '));
	}

	chrome.notifications.onClicked.addListener(function(id) {
		chrome.notifications.clear(id);
	});

	chrome.windows.onCreated.addListener(function() {
		tick(true);
	});

	// Events
	// tabs.onCreated - add to list
	t5.onCreated.addListener(function(tab) {
		tabs[tab.id] = createNewTabInfo(tab);

		checkAndTurnOffAutoDiscardable(tab);

		historyOpenerController.onNewTab(tab);

		if (tab.active === false)
			if (settings.get('openUnfocusedTabDiscarded') == true) {
				tabs[tab.id].markedForDiscard = true;
			}
	});

	// tabs.onRemoved - load if unloaded, remove from list
	t5.onRemoved.addListener(function(tabId) {
		'use strict';

		let i;
		for (i in tabs) {
			if (tabs.hasOwnProperty(i) && i == tabId) {
				delete tabs[i];

				break;
			}
		}

		historyOpenerController.onRemoveTab(tabId);
	});

	window.isTabParked = function(tab) {
		'use strict';

		return tab.url.substring(0, tab.url.indexOf('?')) === extUrl;
	};

	// tabs.onSelectionChanged - load if unloaded, reset inactivity
	t5.onActivated.addListener(function(activeInfo) {
		'use strict';

		t5.get(activeInfo.tabId, function(tab) {

			getTabInfo(tab).swch_cnt++;
			getTabInfo(tab).time = 0;
			getTabInfo(tab).active_time += tickSize * (isAudiable(tab) ? 1.5 : 1);
			getTabInfo(tab).suspended_time = 0;
			getTabInfo(tab).parkTrys = 0;

			try {
				if (isTabParked(tab)) {
					if (settings.get('autoRestoreTab'))
						unsuspendTab(tab);
				} else if (!tab.discarded && settings.get('animateTabIconSuspendTimeout'))
					t5.sendMessage(activeInfo.tabId, {
						method: '[AutomaticTabCleaner:highliteFavicon]',
						highliteInfo: { suspendPercent: 0 }
					});
			} catch (e) {
				console.error(e);
			}

			try {
				if (/*isTabURLAllowedForPark(tab) &&*/ !isTabParked(tab) && tab.url.indexOf(sessionsPageUrl) == -1) {
					if (!tab.discarded)
						(function(closureTab) {
							setTimeout(function() {
								captureTab(closureTab, { checkActiveTabNotChanged: true });
							}, 400);
						})(tab);

					if (tabs[tab.id] != null)
						tabs[tab.id].lstSwchTime = Date.now();
				}
			} catch (e) {
				console.error(e);
			}

			try {
				if (tab.url.indexOf(sessionsPageUrl) == 0)
					chrome.tabs.sendMessage(tab.id, { 'method': '[AutomaticTabCleaner:updateSessions]' });
			} catch (e) {
				console.error(e);
			}

			/* Change Icon to green */
			new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).updateStatus(tab);
		});
	});

	t5.onUpdated.addListener(function(_tabId, changeInfo, tab) {
		'use strict';

		if (changeInfo.discarded == false && tab.active == true && isTabParked(tab) && getScreenCache == null)
			try {
				let sessionId = parseUrlParam(tab.url, 'sessionId');
				let tabId = parseUrlParam(tab.url, 'tabId');
				if (sessionId != null && tabId != null) {
					getScreenCache = {
						sessionId: sessionId,
						tabId: tabId,
						getScreenPromise: new Promise(function(resolve) {
							getScreen(tabId, sessionId, function(screen, pixRat) {
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
				// eslint-disable-next-line no-empty
			} catch (e) {
			}

		getTabInfo(tab);

		try {
			if (tab.active == false && tab.status === 'loading') {
				if (tabs[tab.id].markedForDiscard == true) {
					if (tab.favIconUrl != null && tab.title != null && tab.title != tab.url) {
						console.log('Discarding Tab: ', tab.url);
						discardTab(tab.id);
						tabs[tab.id].discarded = true;
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

			getTabInfo(tab).nonCmpltInput = false;

			if (tab.active === true) {
				if (isTabURLAllowedForPark(tab)) {
					setTimeout(function() {
						captureTab(tab);
					}, 150);
					captured = true;
				}

				/* Change Icon to green */
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).updateStatus(tab);
			}

			if (isTabParked(tab))
				t5.getZoom(tab.id, function(zoomFactor) {
					if (zoomFactor != 1.0)
						t5.setZoom(tab.id, 1.0);
				});
		}

		if (changeInfo.url != null) {
			if (getTabInfo(tab).parkedUrl != null &&
				getTabInfo(tab).parkedUrl != changeInfo.url)
				if (!(changeInfo.url.indexOf(extUrl) == 0 && getTabInfo(tab).parkedUrl.indexOf(extUrl) < 0)) {
					getTabInfo(tab).parkedUrl = null;
				}
		}

		if (isTabParked(tab)) {
			getTabInfo(tab).parked = true;
			if (changeInfo.discarded != null && changeInfo.discarded == false)
				getTabInfo(tab).discarded = false;
		} else {
			getTabInfo(tab).parked = false;

			if (tab.active == true)
				if (!captured && changeInfo.status != 'loading')
					setTimeout(function() {
						captureTab(tab);
					}, 150);
		}
	});

	t5.onReplaced.addListener(function(addedTabId, removedTabId) {
		tabs[addedTabId] = tabs[removedTabId];
		tabs[addedTabId].id = addedTabId;
		delete tabs[removedTabId];
	});

	e5.onRequest.addListener(function(request, sender, sendResponse) {
		if (request.method === '[AutomaticTabCleaner:ReloadSettings]') {
			if (debug)
				console.log(request.method);
			reloadSettings({ fromSettingsPage: true });
		} else if (request.method === '[AutomaticTabCleaner:resetAllSettings]') {
			settings.removeAll();
			settings = new Store(settingsStorageNamespace, window.DEFAULT_SETTINGS);
			settings.set(INSTALLED, true);
			reloadSettings(/*{fromSettingsPage: true}*/);
		} else if (request.method === '[AutomaticTabCleaner:exportAllSettings]') {
			sendResponse({settings: JSON.stringify(settings.toObject(), null, 2)});
		} else if (request.method === '[AutomaticTabCleaner:importAllSettings]') {
			settings.removeAll();
			settings = new Store(settingsStorageNamespace, { ...window.DEFAULT_SETTINGS, ...request.settings });
			settings.set(INSTALLED, true);
			reloadSettings(/*{fromSettingsPage: true}*/);
		}
	});


	chrome.runtime.setUninstallURL('https://uninstall.tab-suspender.com/', null);

	/*
	 * STARTUP/UPDATE
	 */


	let restoreTabOnStartup_TemporarlyEnabel = false;
	let menuId;

	// init function
	/**
	 *
	 */
	function init(options) {
		'use strict';

		console.log('Started at ' + new Date() + ' with restoreTabOnStartup_TemporarlyEnabel=' + restoreTabOnStartup_TemporarlyEnabel);

		screenshotQuality = settings.get('screenshotQuality');

		try {
			navigator.getBattery().then(function(battery) {
				battery.onchargingchange = function(event) {
					isCharging = event.target.charging;
					console.log('Charging: ' + event.target.charging);
				};
				console.log('Startup Charging: ' + battery.charging);
				isCharging = battery.charging;
			});
		} catch (e) {
			console.log('navigator.getBattery() does not support by browser!');
		}

		if (menuId == null)
			chrome.commands.getAll(function(commands) {
				if (debug)
					console.log('Commands:', commands);

				menuId = chrome.contextMenus.create({
					title: 'Tab Suspender',
					contexts: ['all'],  // ContextType
					onclick: null // A callback function
				});

				if (debug)
					console.log('Menu id', menuId);

				globalMenuIdMap = createSecondLevelMenu(menuId, commands, [
					{
						type: 'checkbox',
						id: 'add_to_white_list',
						title: 'Add to Whitelist...',
						contexts: ['all'],
						onclick: function(info, tab) {
							if (info == null || info.checked) {
								if (!whiteList.isURIException(tab.url)) {
									t5.sendMessage(tab.id, { method: '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]' });
									new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
								}
							} else
								removeUrlFromWhitelist(tab.url);
						},
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*'],
						_command: 'add-to-white-list'
					},
					{
						type: 'hidden',
						id: 'remove_from_white_list',
						title: 'Remove from Whitelist',
						contexts: ['all'],
						onclick: function(info, tab) {
							removeUrlFromWhitelist(tab.url);
						},
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*'],
						/*enabled: false*/
						_command: 'remove-from-white-list'
					},
					{
						type: 'separator',
						title: 'Whitelist separator',
						contexts: ['all'],
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*']
					},
					{
						title: 'Suspend Current Tab',
						contexts: ['all'],
						onclick: function(info, tab) {
							parkTab(tab, tab.id);
						},
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*'],
						_command: 'suspend-current'
					},
					{
						title: 'Suspend All',
						contexts: ['all'],
						onclick: function() {
							parkTabs(null);
						},
						parentId: menuId
					},
					{
						title: 'Suspend All Other',
						contexts: ['all'],
						onclick: function(info, tab) {
							parkTabs(tab);
						},
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*'],
						_command: 'suspend-all-other'
					},
					{
						title: 'Suspend Window',
						contexts: ['all'],
						onclick: function(info, tab) {
							parkTabs(tab, tab.windowId);
						},
						parentId: menuId,
						_command: 'suspend-all-window'
					},
					{
						title: 'Unsuspend All Tabs',
						contexts: ['all'],
						onclick: function() {
							unsuspendTabs();
						},
						parentId: menuId,
						_command: 'unsuspend-all-tabs'
					},
					{
						title: 'Unsuspend Window',
						contexts: ['all'],
						onclick: function(info, tab) {
							unsuspendTabs(tab.windowId);
						},
						parentId: menuId,
						_command: 'unsuspend-current-window'
					},
					{
						title: 'Unsuspend Current Tab',
						contexts: ['all'],
						onclick: function(info, tab) {
							unsuspendTab(tab);
						},
						parentId: menuId,
						_command: 'unsuspend-current-tab',
						documentUrlPatterns: [extUrl + '**']
					},
					{
						type: 'separator',
						title: 'Whitelist separator',
						contexts: ['all'],
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*']
					},
					{
						type: 'checkbox',
						title: 'Ignore Current Tab',
						contexts: ['all'],
						onclick: function(info, tab) {
							if (info == null || info.checked) {
								addToIgnoreTabList(tab.id);
							} else {
								removeFromIgnoreTabList(tab.id);
							}
						},
						parentId: menuId,
						id: 'ignore-current-tab',
						_command: 'ignore-current-tab',
						documentUrlPatterns: ['http://*/*', 'https://*/*']
					},
					{
						type: 'hidden',
						contexts: ['all'],
						title: 'Suspend or Unsuspend Current Tab (in one HotKey)',
						parentId: menuId,
						onclick: function(info, tab) {
							if (!tab.url.startsWith(extUrl)) {
								parkTab(tab, tab.id);
							} else {
								unsuspendTab(tab);
							}
						},
						_command: 'suspend-or-unsuspend-current-tab'
					},
					{
						type: 'separator',
						title: 'Whitelist separator',
						contexts: ['all'],
						parentId: menuId,
						documentUrlPatterns: ['http://*/*', 'https://*/*']
					},
					{
						title: 'Change Hotkeys...',
						contexts: ['all'],
						onclick: function() {
							chrome.tabs.create({ 'url': 'chrome://extensions/configureCommands' }, function() {
							});
						},
						parentId: menuId
					}
				]);
			});

		whiteList = new WhiteList(settings);

		// get all windows with tabs
		c5.windows.getAll({ 'populate': true }, function(wins) {
			'use strict';

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

								/* TURN OFF AUTODISCARTABLE */
								checkAndTurnOffAutoDiscardable(wins[i].tabs[j]);

								// HISTORY SUPPORT LOGIC
								historyOpenerController.collectInitialTabState(wins[i].tabs[j]);

								if (options == null || options.reloadSettings == null || options.reloadSettings == false)
									if (isTabURLAllowedForPark(wins[i].tabs[j]) && wins[i].tabs[j].url.indexOf('https://chrome.google.com/webstore') < 0 && wins[i].tabs[j].discarded == false)
										injectJS(id);

								/* COLLECT TABS INFO */
								if (tabs[id] == null)
									tabs[id] = createNewTabInfo(wins[i].tabs[j]);
							}
						}
					}
				}
			} catch (e) {
				console.error('Exception while restoreTabFromLstSession:', e);
			}

			/* Restore parkHistory */
			try {
				parkHistory = JSON.parse(localStorage.getItem('parkHistory'));
				if (!Array.isArray(parkHistory))
					parkHistory = [];
			} catch (e) {
				console.error('Exception while restore previous parkHistory:', e);
			}

			/* Restore closeHistory */
			try {
				closeHistory = JSON.parse(localStorage.getItem('closeHistory'));
				if (!Array.isArray(closeHistory))
					closeHistory = [];
			} catch (e) {
				console.error('Exception while restore previous closeHistory:', e);
			}
		});
	}

	/**
	 *
	 */
	r5.onUpdateAvailable.addListener(function(details) {
		console.log('Update available.. ' + (details ? details.version : 'no version info.'));
	});


	let expectedInjectExceptions = ['The tab was closed.',
		'The extensions gallery cannot be scripted.',
		//'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',
		'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
		'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab'];

	function injectJS(tabId) {
		'use strict';

		try {
			let closureId = tabId;
			t5.executeScript(closureId, { file: 'lib/h2c.js' }, function() {
				hasLastError(expectedInjectExceptions);

				if (debug && debugInit) {
					console.log(closureId);
				}
				t5.executeScript(closureId, { file: 'inject.js' }, function() {
					hasLastError(expectedInjectExceptions);
				});
			});
		} catch (e) {
			console.error('injectJS exception', e);
		}
	}

	/**
	 *
	 */
	r5.onInstalled.addListener(function(details) {

		if (debug)
			console.log('Installed at ' + new Date().getTime());

		if (details.reason == 'install') {
			if (debug)
				console.log('This is a first install!');
		} else if (details.reason == 'update') {
			let thisVersion = chrome.runtime.getManifest().version;
			console.log('Updated from ' + details.previousVersion + ' to ' + thisVersion + '!'); /* Updated from 0.4.8.3 to 0.4.8.4! */


			/************* PATCHES: ********************************
			 * TODO: remove this variable after migration complete!!!
			 *******************************************************/
			/* PATCH #1 */
			if (versionCompare(details.previousVersion, '0.4.8.2') < 0)
				restoreTabOnStartup_TemporarlyEnabel = true;

			settingsInitedPromise.then(function() {
				/* PATCH #2 */
				if (versionCompare(details.previousVersion, '1.3.2.3') < 0) {
					console.log('Disabling "animateTabIconSuspendTimeout" for versions less then 1.3.2.3...');
					settings.set('animateTabIconSuspendTimeout', false);
				}
				/* PATCH #3 */
				if (versionCompare(details.previousVersion, '1.3.2.4') < 0) {
					if (settings.get('screenshotQuality') == 100)
						settings.set('screenshotQuality', 90);
				}
			});
		}
	});

	/**
	 *
	 */
	function reloadSettings(options) {
		if (ticker) {
			clearInterval(ticker);
			ticker = null;
		}

		/* STORE TABS STATE */
		tick(true);

		preInit({ reloadSettings: true });

		if (!options || !options.fromSettingsPage)
			reloadSettingsPage();

		r5.sendMessage({
			'method': '[AutomaticTabCleaner:UpdateTabsSettings]',
			'restoreEvent': window.getRestoreEvent(),
			'reloadTabOnRestore': window.getReloadTabOnRestore(),
			'parkBgColor': window.getParkBgColor(),
			'screenshotCssStyle': window.getScreenshotCssStyle(),
			'restoreButtonView': window.getRestoreButtonView(),
			'tabIconOpacityChange': window.getTabIconOpacityChange(),
			'tabIconStatusVisualize': window.getTabIconStatusVisualize()
		});
	}

	/**
	 *
	 */
	function reloadSettingsPage() {
		let manifest = chrome.runtime.getManifest();
		let extviews = chrome.extension.getViews();
		let settingsPage = chrome.extension.getURL(manifest.options_page);

		for (let i = 0; i <= extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href == settingsPage) {
				extviews[i].chrome.tabs.getCurrent(function(tab) {
					chrome.tabs.reload(tab.id, {});
				});
				break;
			}
		}
	}

	/**
	 *
	 */
	function reloadHistoryPage() {
		let extviews = chrome.extension.getViews();
		let settingsPage = chrome.extension.getURL('history.html');

		for (let i = 0; i <= extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href == settingsPage) {
				extviews[i].chrome.tabs.getCurrent(function(tab) {
					chrome.tabs.reload(tab.id, {});
				});
				break;
			}
		}
	}


	/**
	 *
	 */
	function drawSetupWizardDialog() {
		chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
			t5.create({
				'windowId': tabs[0].windowId,
				'index': tabs[0].index + 1,
				'url': e5.getURL('wizard_background.html'),
				'active': true
			});
		});
	}

	/**
	 *
	 */
	let lastRow = -1;

	function copyWebSqlToIndexedDB() {

		let cleanAndCloseWebSql = function() {
			console.log('DB Moved From WebSql To IndexedDB !!!!!!!!!!!!!');

			dbMovedFromWebSqlToIndexedDB = true;
			localStorage.setItem('dbMovedFromWebSqlToIndexedDB', true);
			/* DELETE * FORM WEBSQL... */

			webSqlDatabase.executeDelete({
				WebSQL:
					{
						query: 'DROP TABLE screens',
						params: []
					}
			});

			webSqlDatabase = null;
			console.log('WebSqlDB removed && closed !!!!!!!!!!!!!');
		};

		let copyFromWebSqlToIndexedDBOneByOne;
		copyFromWebSqlToIndexedDBOneByOne = function(offset) {
			webSqlDatabase.getAll({
					WebSQL:
						{
							query: 'select id, sessionId, added_on, screen from screens LIMIT ' + offset + ', 2',
							params: null
						}

				}, function(resultsRowsArray) {
					if (resultsRowsArray != null) {
						let callPut = function(curI) {
							setTimeout(function() {

								if (resultsRowsArray[curI] != null) {
									let data =
										{
											'id': parseInt(resultsRowsArray[curI].id),
											'sessionId': resultsRowsArray[curI].sessionId,
											'added_on': resultsRowsArray[curI].added_on,
											'screen': resultsRowsArray[curI].screen
										};

									database.put(
										{
											IDB:
												{
													table: 'screens',
													data: data
												}
										}
									);
								}

								console.log('Moved ' + curI + ' from ' + lastRow + ' records.');

								if (lastRow == offset)
									cleanAndCloseWebSql();

							}, 1500 * offset);
						};

						callPut(0);

						if (resultsRowsArray.length > 1)
							copyFromWebSqlToIndexedDBOneByOne(offset + 1);
						else
							lastRow = offset;
					}
				},
				function(e) {
					console.log('Error when open WebSqlDB: ', e);
					console.log('Removing WebSqlDB...');
					cleanAndCloseWebSql();
				});
		};

		copyFromWebSqlToIndexedDBOneByOne(0);
	}

	/**
	 *
	 */
	function cleanupDB() {
		console.log('DB Cleanup started...');

		// schedule next cleanup in next days
		setTimeout(cleanupDB, 1000 * 60 * 60 * 24);

		let usedSessionIds = {};
		let usedTabIds = {};

		t5.query({}, function(tabs) {
			for (let i in tabs)
				if (tabs.hasOwnProperty(i))
					if (tabs[i].url.indexOf(extUrl) == 0) {
						let sessionId = parseUrlParam(tabs[i].url, 'sessionId');
						const tabId = parseUrlParam(tabs[i].url, 'tabId');
						if (sessionId != null)
							usedSessionIds[sessionId] = true;
						if (tabId != null)
							usedTabIds[tabId] = sessionId;
					}

			usedSessionIds[parseInt(window.TSSessionId)] = true;
			usedSessionIds[parseInt(window.previousTSSessionId)] = true;

			database.getAll({
				IDB:
					{
						table: 'screens',
						index: ADDED_ON_INDEX_NAME,
						predicate: 'getAllKeys',
						predicateResultLogic: function(result) {
							let filtredResult = [];
							let filterdSessionKeysArray = Object.keys(usedSessionIds);
							console.log(filterdSessionKeysArray);
							/* [sessionId NOT IN] IMPLEMENTATION */
							let isScreenActual;
							for (let i = 0; i < result.length; i++) {
								isScreenActual = false;

								if (usedSessionIds[result[i][1]]) {
									if (usedTabIds[result[i][0]]) {
										isScreenActual = true;
									} else if (Math.abs(new Date() - result[i][2]) > 1000 * 60 * 60 * 24 * 14 /* > Two weeks */) {
										isScreenActual = false;
									} else {
										isScreenActual = true;
									}
								}

								if (!isScreenActual)
									filtredResult.push(result[i]);
							}

							return filtredResult;
						}
					},
				WebSQL:
					{
						query: 'select sessionId from screens where sessionId NOT IN ("' + Object.keys(usedSessionIds).join('","') + '") group by sessionId',
						params: null
					}

			}, function(resultsRowsArray) {
				if (resultsRowsArray != null) {
					if (debugDBCleanup) {
						console.log(`ScreensToCleanup: ${resultsRowsArray.length}`);
					}
					for (let i = 0; i < resultsRowsArray.length; i++) {
						let callDelete = function(curI) {
							setTimeout(function() {

								if (debugDBCleanup) {
									console.log(`Cleanup: ${resultsRowsArray[curI]}`);
								}

								database.executeDelete({
									IDB:
										{
											table: 'screens',
											index: 'PK',
											params: [resultsRowsArray[curI][0], resultsRowsArray[curI][1]]
										},
									WebSQL:
										{
											query: 'delete from screens where sessionId = ?',
											params: [resultsRowsArray[curI].sessionId]
										}
								});
							}, 2000 * curI);
						};

						callDelete(i);
					}
				}
			});
		});


		let factor = new Date();
		factor.toString = function() {
			this.on = true;
		};

		let interval = setInterval(function() {
			factor.info = '!READ THIS!: Temporarly Marketing investigation for total active users of Tab Suspender. (will be removed after 2-3 weeks of research)';
			console.log('%c', factor);
			if (!factor.on)
				trackView('active_user');
			else {
				clearInterval(interval);
			}
		}, 1740 * 1000  /*30*1000*/);
	}


	/**
	 *
	 */
	function start() {
		'use strict';

		console.log(Copyright);

		if (debug)
			console.log('Starting...');

		trackErrors('background', false);

		startedAt = new Date().getTime();
		extUrl = e5.getURL('park.html');
		window.TSSessionId = Date.now();
		console.log('window.TSSessionId: ', window.TSSessionId);

		/* Save last session ID */
		console.log('window.previousTSSessionId: ', window.previousTSSessionId);
		window.previousTSSessionId = JSON.parse(localStorage.getItem('TSSessionId'));
		console.log('window.previousTSSessionId: ', window.previousTSSessionId);
		localStorage.setItem('TSSessionId', window.TSSessionId);

		/* Connect DB */
		database = new DBProvider('IndexedDB');

		dbMovedFromWebSqlToIndexedDB = JSON.parse(localStorage.getItem('dbMovedFromWebSqlToIndexedDB'));
		if (dbMovedFromWebSqlToIndexedDB != true) {
			webSqlDatabase = new DBProvider('WebSQl', { skipSchemaCreation: true });
			console.log('Moving to IndexedDB...');
			setTimeout(function() {
				database.getInitializedPromise().then(copyWebSqlToIndexedDB);
			}, DELAY_BEFORE_DB_MIGRATE_TO_INDEXEDDB);
		} else
			console.log('Already moved to IndexedDB.');

		setTimeout(cleanupDB, DELAY_BEFORE_DB_CLEANUP);


		let prepare = function() {
			/* TODO: cleanup this logic after cleanup complete! */

			/* Prerare settings */
			let firstInstallation = ((Store.get('timeout', settingsStorageNamespace)) == null && !chrome.extension.inIncognitoContext);
			settings = new Store(settingsStorageNamespace, window.DEFAULT_SETTINGS);
			settingsInitedResolve();

			/*
			 * TODO: WIZARD: ADD IF FOR IS IT FIRST INSTALL OR UPDATE ONLY!!!
			 */
			try {
				settings.getOnStorageInitialized().then(() => {
					let isAlreadyHasSyncSettings = ((settings.get(INSTALLED)) != null && !chrome.extension.inIncognitoContext);
					if (firstInstallation && !isAlreadyHasSyncSettings) {
						console.log('EX: Installed!');
						drawSetupWizardDialog();
						trackView(INSTALLED);
					} else {
						console.log('EX: Updated!');
						if(!isAlreadyHasSyncSettings) {
							settings.set(INSTALLED, true);
						}
					}
				});
				// eslint-disable-next-line no-empty
			} catch (e) {
			}

			window.TSSettingsInitialized = true;

			/* WILL BE INITALIZED 2 TIMES: HERE AND INSIDE INIT(..) TO RELOAD SETTINGS */
			whiteList = new WhiteList(settings);

			/* Discard tabs */
			t5.query({ active: false/*, discarded: false*/ }, function(tabs) {
				let localExtUrl = extUrl;
				for (let i in tabs) {
					if (tabs.hasOwnProperty(i)) {


						if (tabs[i].url.indexOf(localExtUrl) == 0) {
							if (tabs[i].url.startsWith(chrome.extension.getURL('park.html')))
								if (tabs[i].favIconUrl === null || tabs[i].favIconUrl == '') {
									chrome.tabs.reload(tabs[i].id);
								}
						}

						if (tabs[i].url.indexOf(localExtUrl) == -1)
							if (settings.get('startNormalTabsDiscarted') == true)
								if (tabs[i].discarded == false)
									if (!isExceptionTab(tabs[i]))
										try {
											discardTab(tabs[i].id);
										} catch (e) {
											console.error('Discard error', e);
										}

					}
				}
			});

			if (debug)
				setTimeout(preInit, 2000);
			else
				setTimeout(preInit, 1000);
		};

		/* Adjust DEFAULT_SETTINGS.limitOfOpenedTabs according of Screen size */
		if (chrome.hasOwnProperty('system') && chrome.system.hasOwnProperty('display'))
			try {
				chrome.system.display.getInfo(function(displayInfo) {
					try {
						if (displayInfo != null) {
							let displayWidth = displayInfo[0].workArea.width;

							if (displayWidth != null && displayWidth > 0)
								window.DEFAULT_SETTINGS.limitOfOpenedTabs = parseInt(displayWidth / 90.29);
						}
					} catch (e) {
						console.error(e);
					}

					prepare();
				});
			} catch (e) {
				console.error(e);
				prepare();
			}
		else
			prepare();
	}

	/**
	 *
	 */
	function preInit(options) {
		'use strict';

		init(options);

		if (settings.get('active')) //{
			ticker = setInterval(tick, tickSize * 1000);

		new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	window.addEventListener('load', start);
})();
