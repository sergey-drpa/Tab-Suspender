/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
'use strict';

const Copyright = 'Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy. Zadorozhniy.Sergey@gmail.com';
const TS_SESSION_ID_KEY = 'TSSessionId';

const TSSessionId = Date.now();
let previousTSSessionId;


// Globals
const parkUrl = chrome.runtime.getURL('park.html');


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const historyPageUrl = chrome.runtime.getURL('history.html');

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let database: DBProvider;
let parkHistory = [];
let closeHistory = [];
//window.tabScreens = {}; // map of tabIDs with last 'screen'
let settings: SettingsStore;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let pauseTics = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let pauseTicsStartedFrom = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let isCharging = true;
let startedAt = new Date().getTime();
const firstTimeTabDiscardMap = {};

let whiteList: WhiteList;
const offscreenDocumentProvider = new OffscreenDocumentProvider();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let windowManger: WindowManager;
let tabManager: TabManager;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tabObserver: TabObserver;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tabCapture: TabCapture;
let contextMenuController: ContextMenuController;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let formRestoreController: PageStateRestoreController;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let settingsPageController: SettingsPageController;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let ignoreList: IgnoreList;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let bgMessageListener: BGMessageListener;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tabsMarkedForUnsuspend = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TABS_MARKED_FOR_UNSUSPEND_TTL = 5000;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let batteryLevel = -1.0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let getScreenCache = null;
// eslint-disable-next-line prefer-const

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const openSuspendedHistory = () =>
	focusOrOpenTSPage(chrome.runtime.getURL('history.html'));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const openClosedHistory = () =>
	focusOrOpenTSPage(chrome.runtime.getURL('history.html') + '#closed');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getRestoreEvent = async function() {
	return (await settings.get('restoreOnMouseHover') == true ? 'hover' : 'click');
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getReloadTabOnRestore = (): Promise<boolean> =>
	settings.get('reloadTabOnRestore');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getTabIconStatusVisualize = (): Promise<boolean> =>
	settings.get('tabIconStatusVisualize');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getTabIconOpacityChange = (): Promise<boolean> =>
	settings.get('tabIconOpacityChange');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getRestoreButtonView = (): Promise<string> =>
	settings.get('restoreButtonView');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getScreenshotCssStyle = (): Promise<string> =>
	settings.get('screenshotCssStyle');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getStartDiscarted = function(): Promise<boolean> {
	return settings.get('startDiscarted');
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isFirstTimeTabDiscard = function(tabId) {
	const isFirstTime = !(tabId in firstTimeTabDiscardMap);
	firstTimeTabDiscardMap[tabId] = true;
	return isFirstTime;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getParkBgColor = async function(): Promise<string> {
	const color = await settings.get('parkBgColor');
	if (color != null && color.search(/^([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) >= 0)
		return color;
	else
		return DEFAULT_SETTINGS.parkBgColor;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getStartedAt = async function() {
	return startedAt;
};

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

	contextMenuController.create(parkUrl);

	whiteList = new WhiteList(settings);

	tabManager.init(options);

	/* Restore parkHistory */
	try {
		parkHistory = await LocalStore.get(LocalStoreKeys.PARK_HISTORY);
		if (!Array.isArray(parkHistory))
			parkHistory = [];
	} catch (e) {
		console.error('Exception while restore previous parkHistory:', e);
	}

	/* Restore closeHistory */
	try {
		closeHistory = await LocalStore.get(LocalStoreKeys.CLOSE_HISTORY);
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

		//settings.getOnStorageInitialized().then(async function() {
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
			console.log('previousTSSessionId is stored in chrome.storage.local');
		}, console.error);
	}).catch(() => {
		console.error('previousTSSessionId is not found in chrome.storage.local');
	});


	/* Connect DB */
	// @ts-ignore
	database = new DBProvider('IndexedDB');

	setTimeout(cleanupDB, DELAY_BEFORE_DB_CLEANUP);


	const prepare = async function() {
		/* TODO: cleanup this logic after cleanup complete! */

		/* Prepare settings */
		const firstInstallation = ((await SettingsStoreClient.get('timeout', SETTINGS_STORAGE_NAMESPACE)) == null && !chrome.extension.inIncognitoContext);

		settings = new SettingsStore(SETTINGS_STORAGE_NAMESPACE, DEFAULT_SETTINGS, offscreenDocumentProvider);

		/*
		 * TODO: WIZARD: ADD IF FOR IS IT FIRST INSTALL OR UPDATE ONLY!!!
		 */
		try {
			settings.getOnStorageInitialized().then(async () => {

				/* ????? WILL BE INITIALISED 2 TIMES: HERE AND INSIDE INIT(..) TO RELOAD SETTINGS ?????????? */
				whiteList = new WhiteList(settings);

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

				setTimeout(() => void trackView('TS started', { version: chrome.runtime.getManifest().version }), 5000);

				const isAlreadyHasSyncSettings = ((await LocalStore.get(LocalStoreKeys.INSTALLED)) != null && !chrome.extension.inIncognitoContext);
				if (firstInstallation && !isAlreadyHasSyncSettings) {
					console.log('EX: Installed!');
					drawSetupWizardDialog();
					setTimeout(() => void trackView(LocalStoreKeys.INSTALLED), 5000);
				} else {
					console.log('EX: Updated!');
					//setTimeout(() => void trackView('updated'), 5000);
					if (!isAlreadyHasSyncSettings) {
						LocalStore.set(LocalStoreKeys.INSTALLED, true).catch(console.error);
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

		// Wait for session restore, then process tabs
		await SessionRestoreDetector.waitForGroupRestore({ parkUrl });

		const startNormalTabsDiscarted = await settings.get('startNormalTabsDiscarted');
		/* Discard tabs */
		chrome.tabs.query({ active: false/*, discarded: false*/ }, async function(tabs) {
			console.log('Processing tabs after session restore - total tabs:', tabs.length);

			for (const i in tabs) {
				if (tabs.hasOwnProperty(i)) {
					if (tabs[i].url.indexOf(parkUrl) == 0) {
						if (tabs[i].url.startsWith(parkUrl))
							if (tabs[i].favIconUrl === null || tabs[i].favIconUrl == '') {
								chrome.tabs.reload(tabs[i].id).catch(console.error);
							}
					}

					if (tabs[i].url.indexOf(parkUrl) == -1) {
						if (startNormalTabsDiscarted)
							if (tabs[i].discarded == false)
								if (!await tabManager.isExceptionTab(tabs[i]))
									try {
										console.log('Discarding tab:', tabs[i].id, 'groupId:', tabs[i].groupId, 'url:', tabs[i].url);
										discardTab(tabs[i].id);
									} catch (e) {
										console.error('Discard error', e);
									}
					}
				}
			}
		});
	};

	void prepare();
}

/**
 *
 */
async function preInit(options) {

	await init(options);

	new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
}

start();
