/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
"use strict";

const INSTALLED = 'installed';

	const Copyright = 'Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy. Zadorozhniy.Sergey@gmail.com';
	const TS_SESSION_ID_KEY = 'TSSessionId';
	const DELAY_BEFORE_DB_CLEANUP = 60 * 1000;

	const TSSessionId = Date.now();
	let previousTSSessionId;

	/* Debug */
	//let debug = false;
	const debugInit = false;
	const debugScreenCache = true;


	// Globals
	const parkUrl = chrome.runtime.getURL('park.html');;
	const rootExtensionUri = chrome.runtime.getURL('');
	const sessionsPageUrl = chrome.runtime.getURL('sessions.html');
	const historyPageUrl = chrome.runtime.getURL('history.html');
	const wizardPageUrl = chrome.runtime.getURL('wizard_background.html');
  const publicExtensionUrl = 'chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/park.html';
	let database;
	let parkHistory = [];
	let closeHistory = [];
	//window.tabScreens = {}; // map of tabIDs with last 'screen'
	let settings: SettingsStore;
	const debugTabsInfo = false;
	let whiteList;
	let pauseTics = 0;
	let pauseTicsStartedFrom = 0;
	const isCharging = true;
	let startedAt = new Date().getTime();
	const firstTimeTabDiscardMap = {};

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
	let windowManger: WindowManager;
	let tabManager: TabManager;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let tabObserver: TabObserver;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let tabCapture: TabCapture;
	let contextMenuController: ContextMenuController;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let formRestoreController : PageStateRestoreController;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let settingsPageController: SettingsPageController;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let ignoreList: IgnoreList;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let bgMessageListener: BGMessageListener;

	const tabsMarkedForUnsuspend = [];
	const TABS_MARKED_FOR_UNSUSPEND_TTL = 5000;
	const batteryLevel = -1.0;
	let getScreenCache = null;
	// eslint-disable-next-line prefer-const
	let settingsInitedResolve, settingsInitedPromise = new Promise(function(resolve) {
		settingsInitedResolve = resolve;
	});

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const openSuspendedHistory = () =>
		focusOrOpenTSPage(chrome.runtime.getURL('history.html'));

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const openClosedHistory = () =>
		focusOrOpenTSPage(chrome.runtime.getURL('history.html') + '#closed');

	const getRestoreEvent = async function() {
		return (await settings.get('restoreOnMouseHover') == true ? 'hover' : 'click');
	};

	const getReloadTabOnRestore = (): Promise<boolean> =>
		settings.get('reloadTabOnRestore');

	const getTabIconStatusVisualize = (): Promise<boolean> =>
		settings.get('tabIconStatusVisualize');

	const getTabIconOpacityChange = (): Promise<boolean> =>
		settings.get('tabIconOpacityChange');

	const getRestoreButtonView = (): Promise<string> =>
		settings.get('restoreButtonView');

	const getScreenshotCssStyle = (): Promise<string> =>
		settings.get('screenshotCssStyle');

	const getStartDiscarted = function(): Promise<boolean> {
		return settings.get('startDiscarted');
	};

	const isFirstTimeTabDiscard = function(tabId) {
		const isFirstTime = !(tabId in firstTimeTabDiscardMap);
		firstTimeTabDiscardMap[tabId] = true;
		return isFirstTime;
	};

	const getParkBgColor = async function(): Promise<string> {
		const color = await settings.get('parkBgColor');
		if (color != null && color.search(/^([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) >= 0)
			return color;
		else
			return DEFAULT_SETTINGS.parkBgColor;
	};

	const getStartedAt = async function() {
		return startedAt;
	};

	function tabExist(windows, tabId) {
		for (const i in windows)
			if (windows.hasOwnProperty(i))
				for (const j in windows[i].tabs)
					if (windows[i].tabs.hasOwnProperty(j))
						if (windows[i].tabs[j].id == tabId)
							return windows[i].tabs[j];
		return null;
	}

	chrome.notifications.onClicked.addListener(function(id) {
		chrome.notifications.clear(id);
	});

	chrome.runtime.setUninstallURL('https://uninstall.tab-suspender.com/', null);

	/*
	 * STARTUP/UPDATE
	 */


	// init function
	/**
	 *
	 */
	async function init(options) {
		'use strict';

		console.log('Started at ' + new Date());

		/* TODO-v3:
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
		}*/

		contextMenuController.create(parkUrl);

		whiteList = new WhiteList(settings);

		tabManager.init(options);

		/* Restore parkHistory */
		try {
			//parkHistory = JSON.parse(localStorage.getItem('parkHistory'));
			parkHistory = await LocalStore.get('parkHistory');
			if (!Array.isArray(parkHistory))
				parkHistory = [];
		} catch (e) {
			console.error('Exception while restore previous parkHistory:', e);
		}

		/* Restore closeHistory */
		try {
			closeHistory = await LocalStore.get('closeHistory');
			if (!Array.isArray(closeHistory))
				closeHistory = [];
		} catch (e) {
			console.error('Exception while restore previous closeHistory:', e);
		}
	}

	/**
	 *
	 */
	chrome.runtime.onUpdateAvailable.addListener(function(details) {
		console.log('Update available.. ' + (details ? details.version : 'no version info.'));
	});

	/**
	 *
	 */
	chrome.runtime.onInstalled.addListener(function(details) {

		if (debug)
			console.log('Installed at ' + new Date().getTime());

		if (details.reason == 'install') {
			if (debug)
				console.log('This is a first install!');
		} else if (details.reason == 'update') {
			const thisVersion = chrome.runtime.getManifest().version;
			console.log('Updated from ' + details.previousVersion + ' to ' + thisVersion + '!'); /* Updated from 0.4.8.3 to 0.4.8.4! */


			/************* PATCHES: ********************************
			 * TODO: remove this variable after migration complete!!!
			 *******************************************************/
			/* PATCH #1 */
			/*if (versionCompare(details.previousVersion, '0.4.8.2') < 0)
				restoreTabOnStartup_TemporarlyEnabel = true;*/

			//settingsInitedPromise.then(async function() {
				/* PATCH #2 */
				/*if (versionCompare(details.previousVersion, '1.3.2.3') < 0) {
					console.log('Disabling "animateTabIconSuspendTimeout" for versions less then 1.3.2.3...');
					settings.set('animateTabIconSuspendTimeout', false);
				}
				/!* PATCH #3 *!/
				if (versionCompare(details.previousVersion, '1.3.2.4') < 0) {
					if (await settings.get('screenshotQuality') == 100)
						settings.set('screenshotQuality', 90);
				}*/
			//}, console.error);
		}
	});

	/**
	 *
	 */
	function drawSetupWizardDialog() {
		chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
			chrome.tabs.create({
				'windowId': tabs[0].windowId,
				'index': tabs[0].index + 1,
				'url': chrome.runtime.getURL('wizard_background.html'),
				'active': true
			}).catch(console.error);
		});
	}

	/**
	 *
	 */
	function start() {

		console.log(Copyright);

		if (debug)
			console.warn('********************************************************************************************************');
			console.warn('* Starting...   ', new Date());
			console.warn('********************************************************************************************************');

		trackErrors('background', false);

		startedAt = new Date().getTime();
		console.log('TSSessionId: ', TSSessionId);

		/* Save last session ID */
		chrome.storage.local.get([TS_SESSION_ID_KEY]).then((result) => {
			previousTSSessionId = result[TS_SESSION_ID_KEY];
			console.log('previousTSSessionId: ', previousTSSessionId);

			chrome.storage.local.set({ [TS_SESSION_ID_KEY]: TSSessionId }).then(() => {
				console.log("previousTSSessionId is stored in chrome.storage.local");
			}, console.error);
		}).catch(()=> {
			console.error("previousTSSessionId is not found in chrome.storage.local");
		});


		/* Connect DB */
		database = new DBProvider('IndexedDB');

		setTimeout(cleanupDB, DELAY_BEFORE_DB_CLEANUP);


		const prepare = async function() {
			/* TODO: cleanup this logic after cleanup complete! */

			/* Prepare settings */
			const firstInstallation = ((await SettingsStore.get('timeout', SETTINGS_STORAGE_NAMESPACE)) == null && !chrome.extension.inIncognitoContext);
			settings = new SettingsStore(SETTINGS_STORAGE_NAMESPACE, DEFAULT_SETTINGS);
			settingsInitedResolve();

			/*
			 * TODO: WIZARD: ADD IF FOR IS IT FIRST INSTALL OR UPDATE ONLY!!!
			 */
			try {
				settings.getOnStorageInitialized().then(async () => {

					windowManger = new WindowManager();
					tabManager = new TabManager();
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					tabObserver = new TabObserver(tabManager);
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					tabCapture = new TabCapture(tabManager);
					contextMenuController = new ContextMenuController(tabManager);
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					formRestoreController = new PageStateRestoreController();
					settingsPageController = new SettingsPageController();
					ignoreList = new IgnoreList();
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					bgMessageListener = new BGMessageListener(tabManager);


					const isAlreadyHasSyncSettings = ((await LocalStore.get(INSTALLED)) != null && !chrome.extension.inIncognitoContext);
					if (firstInstallation && !isAlreadyHasSyncSettings) {
						console.log('EX: Installed!');
						drawSetupWizardDialog();
						trackView(INSTALLED);
					} else {
						console.log('EX: Updated!');
						if(!isAlreadyHasSyncSettings) {
							LocalStore.set(INSTALLED, true).catch(console.error);
						}
					}
				})
					.catch(console.error)
					.finally(() => {
						if (debug)
							setTimeout(preInit, 1000);
						else
							setTimeout(preInit, 500);
					});
				// eslint-disable-next-line no-empty
			} catch (e) {
				console.error(e);
			}

			/* WILL BE INITIALISED 2 TIMES: HERE AND INSIDE INIT(..) TO RELOAD SETTINGS */
			whiteList = new WhiteList(settings);

			const startNormalTabsDiscarted = await settings.get('startNormalTabsDiscarted');
			/* Discard tabs */
			chrome.tabs.query({ active: false/*, discarded: false*/ }, async function(tabs) {
				for (const i in tabs) {
					if (tabs.hasOwnProperty(i)) {
						if (tabs[i].url.indexOf(parkUrl) == 0) {
							if (tabs[i].url.startsWith(parkUrl))
								if (tabs[i].favIconUrl === null || tabs[i].favIconUrl == '') {
									chrome.tabs.reload(tabs[i].id).catch(console.error);
								}
						}

						if (tabs[i].url.indexOf(parkUrl) == -1)
							{
								if (startNormalTabsDiscarted)
									if (tabs[i].discarded == false)
										if (!await tabManager.isExceptionTab(tabs[i]))
											try {
												discardTab(tabs[i].id);
											} catch (e) {
												console.error('Discard error', e);
											}
							}
					}
				}
			});
		};

		/* Adjust DEFAULT_SETTINGS.limitOfOpenedTabs according of Screen size */
		// TODO-v3: move to Settings before apply DEFAULT_SETTINGS
		if (chrome.system?.display)
			try {
				chrome.system.display.getInfo(function(displayInfo) {
					try {
						if (displayInfo != null) {
							const displayWidth = displayInfo[0].workArea.width;

							if (displayWidth != null && displayWidth > 0)
								DEFAULT_SETTINGS.limitOfOpenedTabs = displayWidth / 90.29;
						}
					} catch (e) {
						console.error(e);
					}

					void prepare();
				});
			} catch (e) {
				console.error(e);
				void prepare();
			}
		else
			void prepare();
	}

	/**
	 *
	 */
	async function preInit(options) {

		await init(options);

		new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
	}

	//window_.addEventListener('load', start);
	start();
