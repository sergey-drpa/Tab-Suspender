interface RequestMessageBase {
	method: string;
}

interface RequestParkPageFromInject extends RequestMessageBase{
	tabId: number;
	url: string;
	sessionId: number;
	width: number;
	height: number;
	screenshotQuality: number;
}

const HISTORY_KEEP_LAST_N_ITEMS = 300;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parkTabs(requestTab?, windowId?) {
	const callbackSingle = async function(window: chrome.windows.Window) {
		let number = 0;
		for (const j in window.tabs)
			if (window.tabs.hasOwnProperty(j))
				if (requestTab == null || (requestTab != null && windowId != null) || window.tabs[j].id != requestTab.id)
					if (TabManager.isTabURLAllowedForPark(window.tabs[j]))
						if (!await tabManager.isExceptionTab(window.tabs[j]))
							await parkTab(window.tabs[j], window.tabs[j].id, { bulkNumber: (window.tabs[j].discarded ? number++ : null) });
	};

	const callbackAll = async function(windows: chrome.windows.Window[]) {
		for (const wi in windows)
			if (windows.hasOwnProperty(wi))
				await callbackSingle(windows[wi]);
	};

	if (windowId != null)
		chrome.windows.get(windowId, { 'populate': true }, callbackSingle);
	else
		chrome.windows.getAll({ 'populate': true }, callbackAll);
}

function genYoutubeUrlWithTimeMark(url, videoTime) {
	const urlWithTimeMark = new URL(url);
	urlWithTimeMark.searchParams.set('t', videoTime + 's');
	return urlWithTimeMark.href;
}

// park idle tab if it is not parked yet
async function parkTab(tab: chrome.tabs.Tab, tabId: number, options?) {
	if (!TabManager.isTabURLAllowedForPark(tab))
		return;

	if (tab.discarded && (options == null || options.reloaded == false)) {
		void chrome.tabs.reload(tabId).then(function() {
			setTimeout(function() {
				void parkTab(tab, tabId, { reloaded: true });
			}, (options != null && options.bulkNumber > 0 ? options.bulkNumber * 1000 : 1000));
		});
		return;
	}

	/* Save history
	* TODO: Move to HistoryController */
	let pageState;
	try {
		pageState = await formRestoreController.collectPageState(tabId);

		if(pageState.videoTime != null) {
			tab.url = genYoutubeUrlWithTimeMark(tab.url, pageState.videoTime);
		}

		let duplicate = false;
		if (parkHistory.length > 0 && parkHistory[0].tabId != null && parkHistory[0].sessionId != null)
			if (parkHistory[0].tabId == tabId && parkHistory[0].sessionId == TSSessionId)
				duplicate = true;
		if (!duplicate) {
			parkHistory.splice(0, 0, {
				timestamp: (new Date()).getTime(),
				url: tab.url,
				title: tab.title,
				tabId: tabId,
				sessionId: TSSessionId
			});
			parkHistory.splice(HISTORY_KEEP_LAST_N_ITEMS);
			void LocalStore.set('parkHistory', parkHistory);
		}

	} catch (e) {
		console.error(e);
	}

	/* Detached from thread for collectPageState have chance to process */
	//setTimeout(function() {
	ScreenshotController.isScreenExist(tabId, null, async function(screenExist) {
		if (screenExist == null || parseInt(screenExist) <= 0) {
			if (debug)
				console.log('Screen Not Exist');


			// Try to Capture Tab before Park
			if (options==null || options.retry < 1)
				try {
					console.warn(`Try to Capture Tab before Park...`);
					await tabCapture.captureTab(tab, {tryEvenIncomplete: true});
					await parkTab(tab, tabId, {...options, retry: 1});
					return;
				} catch (e) {
					console.error(`Park Error: `, e);
					return;
				}

			tabManager.getTabInfoOrCreate(tab).lstCapUrl = tab.url;

			let tabParked = false;
			const closureTabId = tabId;
			const closureTab = tab;
			let checkTabIsParked;
			let checkTabIsParkedTimeout;

			const parkByMessage = function(closureTab, closureTabId) {
				chrome.windows.get(closureTab.windowId, async function(win) {
					let width = null;
					if (closureTab.width == null || closureTab.width == 0)
						width = win.width - 20;
					const height = win.height;

					chrome.tabs.sendMessage(closureTabId, <RequestParkPageFromInject>{
							method: '[AutomaticTabCleaner:ParkPageFromInject]',
							tabId: closureTab.id,
							url: closureTab.url,
							sessionId: TSSessionId,
							width: width,
							height: height,
							screenshotQuality: await settings.get('screenshotQuality'),
						},
						function(response) {
							if (response != null) {
								if (response.result == 'successful') {
									tabParked = true;
									tabManager.markTabParked(closureTab);
								} else if (checkTabIsParked != null)
									checkTabIsParked();
							}
							if(debug) {
								console.log('ParkPageFromInject response: ', response);
							}
						});
				});
			};

			parkByMessage(closureTab, closureTabId);

			/*	TODO:	Invesigate https://yandex.ru/maps/2/saint-petersburg/?ll=30.414844%2C60.004372&z=12&mode=search&text=molly&sll=30.414844%2C60.004372&sspn=0.372849%2C0.003782&sctx=ZAAAAAgBEAAaKAoSCVnaqbncUD5AEQZwqwdp901AEhIJwSUCAMDchromez8ROPBhbOXJyz8gACABIAIgAygFMAE4%2BYuinpTW%2BYw1QL2CBkgBVcH%2Bfz9YAGIjZGlyZWN0X2RvbnRfc2hvd19vbl9jaGFpbl9yZXF1ZXN0PTFiKGRpcmVjdF9kb250X3Nob3dfb25fcnVicmljX3dpdGhfYWR2ZXJ0PTFqAnJ1cAA%3D					*/
			/*  DOMException: Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported. */
			/*  Try to reinject JS if parked failed */
			/*								*/
			checkTabIsParkedTimeout = setTimeout(checkTabIsParked = function() {
				if (checkTabIsParkedTimeout != null) {
					clearTimeout(checkTabIsParkedTimeout);
					checkTabIsParkedTimeout = null;
				}

				if (tabParked == false/* && isPageHasNonCompleteInput == false*/) {
					tabCapture.injectJS(closureTabId, closureTab);
					parkByMessage(closureTab, closureTabId);
				}
			}, 10000);
		} else
			try {
				if (debug)
					console.log('Screen Exist');

				//check if parked
				if (tab != null) {
					chrome.tabs.sendMessage(tabId, { method: '[AutomaticTabCleaner:getOriginalFaviconUrl]' }, function(originalFaviconUrl) {

						if (debug)
							console.log('originalFaviconUrl: ', originalFaviconUrl);

						let url = parkUrl + '?title=' + encodeURIComponent(tab.title);
						url += '&url=' + encodeURIComponent(tab.url);
						url += '&tabId=' + encodeURIComponent(tabId);
						url += '&sessionId=' + encodeURIComponent(TSSessionId);

						if (originalFaviconUrl != null && originalFaviconUrl != '')
							url += '&icon=' + encodeURIComponent(originalFaviconUrl);
						else if (tab.favIconUrl)
							url += '&icon=' + encodeURIComponent(tab.favIconUrl);

						chrome.tabs.update(tab.id, { 'url': url }).catch(console.error);
					});
				}

				tabManager.markTabParked(tab);
			} catch (e) {
				console.error('Park by link failed: ', e);
			}
	});
	//}, 200);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unsuspendTabs(windowId?: number) {
	let openedIndex = 1;

	const callbackSingle = function(window) {
		for (const j in window.tabs)
			if (window.tabs.hasOwnProperty(j))
				if (TabManager.isTabParked(window.tabs[j])) {
					const tmpFunction = function(j) {
						const tab = window.tabs[j];
						const clzOpenedIndex = openedIndex++;
						setTimeout(function() {
							tabManager.unsuspendTab(tab);
						}, 1000 * clzOpenedIndex);
					};

					tmpFunction(j);
				}
	};

	const callbackAll = function(windows) {
		for (const wi in windows)
			if (windows.hasOwnProperty(wi))
				callbackSingle(windows[wi]);
	};


	if (windowId != null)
		chrome.windows.get(windowId, { 'populate': true }, callbackSingle);
	else
		chrome.windows.getAll({ 'populate': true }, callbackAll);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function markForUnsuspend(tab) {
	const o = {
		tabId: parseInt(parseUrlParam(tab.url, 'tabId')),
		sessionId: parseInt(parseUrlParam(tab.url, 'sessionId')),
		at: Date.now()
	};
	tabsMarkedForUnsuspend.push(o);

	/* CLEANUP tabsMarkedForUnsuspend */
	const now = Date.now();
	for (let i = 0; i < tabsMarkedForUnsuspend.length; i++) {
		if (now - tabsMarkedForUnsuspend[i].at > TABS_MARKED_FOR_UNSUSPEND_TTL) {
			tabsMarkedForUnsuspend.splice(i, 1);
			i--; // Prevent skipping an item
		}
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		LocalStore.set('closeHistory', closeHistory)
			.then(()=>{ tabManager.historyOpenerController.reloadHistoryPage(); })
			.catch(console.error);
	} catch (e) {
		console.error(e);
	}

	chrome.tabs.remove(tabId, null);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isTabMarkedForUnsuspend(tabIdStr, sessionIdStr, options?) {
	if (tabsMarkedForUnsuspend.length <= 0)
		return false;

	const now = Date.now();
	const tabId = parseInt(tabIdStr);
	const sessionId = parseInt(sessionIdStr);
	for (let i = 0; i < tabsMarkedForUnsuspend.length; i++)
		if (now - tabsMarkedForUnsuspend[i].at <= TABS_MARKED_FOR_UNSUSPEND_TTL && tabsMarkedForUnsuspend[i].tabId == tabId && tabsMarkedForUnsuspend[i].sessionId == sessionId) {
			if (options && options.remove) {
				tabsMarkedForUnsuspend.splice(i, 1);
			}
			return true;
		}
	return false;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function discardTab(tabId) {
	chrome.tabs.discard(tabId, function() {
		hasLastError();
	});
}