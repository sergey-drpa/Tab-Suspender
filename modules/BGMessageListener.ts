
interface ParkPageDataBGResponse {
	tabInfo: ITabInfo;
	startDiscarded: boolean;
	startAt: number;
	isFirstTimeTabDiscard: boolean;
	parkedUrl: string;
	isTabMarkedForUnsuspend: boolean;
	reloadTabOnRestore: boolean;
	tabIconStatusVisualize: boolean;
	tabIconOpacityChange: boolean;
	screenshotCssStyle: string;
	restoreEvent: string;
	parkBgColor: string;
	restoreButtonView: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class BGMessageListener {

	private tabManager: TabManager;

	private readonly BASE64_SEPARATOR = ';base64,';
	private readonly BASE64_SEPARATOR_LENGTH = this.BASE64_SEPARATOR.length;

	constructor(tabManager: TabManager) {
		this.tabManager = tabManager;

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		chrome.runtime.onMessage.addListener(/* DO NOT ADD async HERE IT BROKE sendResponse??*/(request, sender, sendResponse) => {

			/* Screen from h2c, always devicePixelRatio=1*/
		  if (typeof request == 'string') {
				console.warn('Screen Requested', request.length);
				if (request === 'data:,')
					console.error(new Error(`Damaged screen [data:,]!!! id: ${sender.tab.id}`), {favIconUrl: undefined, ...sender.tab});

				ScreenshotController.addScreen(sender.tab.id, request, 1/*TabCapture.lastWindowDevicePixelRatio[sender.tab.windowId]*/);
			} else if (request.method === '[TS:getScreen]') {
				ScreenshotController.getScreen(request.tabId, request.sessionId, (scr, pixRat) => {
					sendResponse({ scr, pixRat });
				});
				return true; // For async sendResponse()
			} else if (request.method === '[TS:dataForParkPage]') {
				void (async () => {
					try {
						const response: ParkPageDataBGResponse = {
							startDiscarded: await getStartDiscarted(),
							startAt: await getStartedAt(),
							isFirstTimeTabDiscard: isFirstTimeTabDiscard(request.tabId),
							parkedUrl: tabManager.getTabInfoById(request.tabId)?.parkedUrl,
							tabInfo: tabManager.getTabInfoById(request.tabId).toObject(),
							isTabMarkedForUnsuspend: isTabMarkedForUnsuspend(request.tabId, request.sessionId, { remove: true }),
							reloadTabOnRestore: await getReloadTabOnRestore(),
							tabIconStatusVisualize: await getTabIconStatusVisualize(),
							tabIconOpacityChange: await getTabIconOpacityChange(),
							screenshotCssStyle: await getScreenshotCssStyle(),
							restoreEvent: await getRestoreEvent(),
							parkBgColor: await getParkBgColor(),
							restoreButtonView: await getRestoreButtonView(),
						};
						sendResponse(response);
					} catch (e) {
						console.error(`[TS:dataForParkPage]: TabId: ${request.tabId}`, e);
					}
				})();
				return true; // For async sendResponse()
			} else if (request.method === '[TS:fetchFavicon]') {
				chrome.tabs.get(sender.tab.id).then((tab) => {
					if (tab.favIconUrl == null) {
						console.trace(`Error fetch() favicon, tab.favIconUrl=(${tab.favIconUrl})`);
						sendResponse(null);
						return;
					}
					if (debug) {
						console.log(`tab.favIconUrl: `, tab.favIconUrl);
					}
					// TODO-v4: Add icon cache
					fetch(tab.favIconUrl/* ? tab.favIconUrl : request.url*/,
						{
							method: 'get'
						})
						.then(async response => {
							const arrayBuffer = await response.arrayBuffer();

							const blob = new Blob([arrayBuffer]);
							const reader = new FileReader();

							reader.onload = (event) => {
								// @ts-ignore
								let dataUrl: string = event.target.result;
								const contentType = response.headers.get("Content-Type");
								const octetStream = 'data:application/octet-stream;base64,';
								if (dataUrl.startsWith(octetStream)) {
									if (contentType.startsWith('image/x-icon') || contentType === 'image/vnd.microsoft.icon') {
										dataUrl = 'data:image/x-icon;base64,' + dataUrl.substring(dataUrl.indexOf(this.BASE64_SEPARATOR) + this.BASE64_SEPARATOR_LENGTH);
									} else if (contentType.startsWith('image/png')) {
										dataUrl = 'data:image/png;base64,' + dataUrl.substring(dataUrl.indexOf(this.BASE64_SEPARATOR) + this.BASE64_SEPARATOR_LENGTH);
									} else if (contentType.startsWith('image/svg+xml')) {
										dataUrl = 'data:image/svg+xml;base64,' + dataUrl.substring(dataUrl.indexOf(this.BASE64_SEPARATOR) + this.BASE64_SEPARATOR_LENGTH);
									} else if (contentType.startsWith('image/jpeg')) {
										dataUrl = 'data:image/jpeg;base64,' + dataUrl.substring(dataUrl.indexOf(this.BASE64_SEPARATOR) + this.BASE64_SEPARATOR_LENGTH);
									}else if (contentType.startsWith('application/octet-stream')) {
										dataUrl = 'data:image/x-icon;base64,' + dataUrl.substring(dataUrl.indexOf(this.BASE64_SEPARATOR) + this.BASE64_SEPARATOR_LENGTH);
										console.warn(`Strange favIcon contentType[${contentType}]`, dataUrl);
									} else {
										console.error(`Unknown content type: ${contentType}`);
									}
								}
								console.log(`Blob[${sender.tab.url}]`, [dataUrl]);
								sendResponse(dataUrl);
							};
							reader.readAsDataURL(blob);
						})
						.catch((e) => {
							console.error(`Error when favicon Fetch(${request.url})`, e);
							sendResponse(null);
						});
				}).catch(console.error);

				return true; // For async sendResponse()
			} else if (request.method === '[AutomaticTabCleaner:trackError]') {
				const error = Error(request.message);
				error.stack = request.stack;
				console.error('[External]: ' + request.message, error);
			} else if (request.method === '[AutomaticTabCleaner:GetTabId]') {
				sendResponse(sender.tab.id);
			} else if (request.method === '[AutomaticTabCleaner:ParkPageFromInjectFinished]') {
				chrome.tabs.update(request.tabId, { 'url': request.url }).catch(console.error);

				tabManager.markTabParkedFromInject(request.tabId);
			} else if (request.method === '[TS:offscreenDocument:batteryStatusChanged]') {
				if ((request.battery as BatteryStatusMessage).isCharging != null)
					isCharging = (request.battery as BatteryStatusMessage).isCharging;
				if ((request.battery as BatteryStatusMessage).level != null)
					batteryLevel = (request.battery as BatteryStatusMessage).level
				console.log(`BGListener - Charging status: ${isCharging}, Level: ${batteryLevel}`);
			} else if (request.method === '[AutomaticTabCleaner:addExceptionPatterns]') {/* DEPREACTED! */
				if (debug)
					console.log('AddExceptionPatterns info Requested.');
				void (async () => {
					settings.set('exceptionPatterns', await settings.get('exceptionPatterns') + '\n' + request.pattern).then(() => {
						sendResponse({ successful: true });
					}).catch(console.error);
				})();
				return true; // For async sendResponse()
			} else if (request.method === '[AutomaticTabCleaner:suspendTab]') {
				if (debug)
					console.log('suspendTab Requested.');
				if (TabManager.isTabURLAllowedForPark(request.tab)) {
					if (debug)
						console.log('Park alowed: ', request.tab);

					void parkTab(request.tab, request.tab.id);

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
				self.tabManager.unsuspendTab(request.tab);
				sendResponse({ successful: true });
			} else if (request.method === '[AutomaticTabCleaner:pause]') {
				if (debug)
					console.log('pause Requested.');

				pauseTics = request.pauseTics;
				pauseTicsStartedFrom = request.pauseTics;

				new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();

				sendResponse({ successful: true, pauseTics: pauseTics });
			} else if (request.method === '[AutomaticTabCleaner:ignoreTab]') {
				if (debug)
					console.log('ignoreTab Requested.');

				if (request.action == 'add')
					ignoreList.addToIgnoreTabList(request.tabId);
				else if (request.action === 'remove')
					ignoreList.removeFromIgnoreTabList(request.tabId);

				sendResponse({ successful: true });
			} else if (request.method === '[AutomaticTabCleaner:popupQuery]') {
				if (debug)
					console.log('popupQuery Requested.');

				popupQuery(request.tab).then((popupQueryResult)=>{
					sendResponse(popupQueryResult);
				}).catch(console.error);

				/*const tabURLAllowedForPark = TabManager.isTabURLAllowedForPark(request.tab);
				let parked;
				try {
					parked = tabManager.getTabInfoById(request.tab.id).parked;
					// eslint-disable-next-line no-empty
				} catch (e) {
					console.error(e)
				}

				if (debug)
					console.log('Park alowed: ' + tabURLAllowedForPark, 'parked: ', parked == true, request.tab);

				void (async () => {
					const response: PopupQueryBGResponse = {
						successful: true,
						allowed: tabURLAllowedForPark,
						timeout: await settings.get('timeout'),
						parked: parked == true,
						pauseTics: pauseTics,
						pauseTicsStartedFrom:
						pauseTicsStartedFrom,
						isTabInIgnoreTabList: ignoreList.isTabInIgnoreTabList(request.tab.id),
						isTabInWhiteList: whiteList.isURIException(request.tab.url),
						isCloseTabsOn: await settings.get('isCloseTabsOn'),
						closeTimeout: await settings.get('closeTimeout'),
						limitOfOpenedTabs: await settings.get('limitOfOpenedTabs')
					};
					sendResponse(response);
				})();*/
				return true; // For async sendResponse()
			} else if (request.method === '[AutomaticTabCleaner:updateTimeout]') {
				if (request.isTabSuspenderActive != null)
					settings.set('active', request.isTabSuspenderActive).catch(console.error);
				else if (request.timeout != null && typeof request.timeout == 'number')
					settings.set('timeout', request.timeout).catch(console.error);
				else if (request.isCloseTabsOn != null)
					settings.set('isCloseTabsOn', request.isCloseTabsOn).catch(console.error);
				else if (request.closeTimeout != null && typeof request.closeTimeout == 'number')
					settings.set('closeTimeout', request.closeTimeout).catch(console.error);
				else if (request.limitOfOpenedTabs != null && typeof request.limitOfOpenedTabs == 'number')
					settings.set('limitOfOpenedTabs', request.limitOfOpenedTabs).catch(console.error);
				else if (request.sendErrors != null)
					settings.set('sendErrors', request.sendErrors).catch(console.error);
				else if (request.popup_showWindowSessionByDefault != null)
					settings.set('popup_showWindowSessionByDefault', request.popup_showWindowSessionByDefault).catch(console.error);
				else if (request.restoreButtonView != null)
					settings.set('restoreButtonView', request.restoreButtonView).catch(console.error);
				else if (request.parkBgColor != null)
					settings.set('parkBgColor', request.parkBgColor).catch(console.error);

				SettingsPageController.reloadSettings().then(()=>{
					sendResponse({ successful: true });
				}).catch(console.error);

				return true;
			} else if (request.method === '[AutomaticTabCleaner:uriExceptionCheck]') {
				sendResponse({ isException: whiteList.isURIException(request.uri) });
			} else if (request.method === '[AutomaticTabCleaner:TabChangedRequestFromInject]') {
				void tabCapture.captureTab(sender.tab);
			} else if (request.method === '[AutomaticTabCleaner:TabUnsuspended]') {
				tabManager.setTabUnsuspended(sender.tab);
				formRestoreController.expectRestore(sender.tab.id, request.targetTabId, request.url);
			} else if (request.method === '[AutomaticTabCleaner:getParkHistory]') {
				sendResponse({ parkHistory: parkHistory, closeHistory: closeHistory });
			} else if (request.method === '[AutomaticTabCleaner:hideDialog]') {
				whiteList.hideWhiteListDialog(sender.tab.id);
				sendResponse({ tabId: sender.tab.id });
			} else if (request.method === '[AutomaticTabCleaner:installed]') {
				LocalStore.set(LocalStoreKeys.INSTALLED, true).catch(console.error);
			} else if (request.method === '[AutomaticTabCleaner:addToWhiteList]') {
				whiteList.addPattern(request.pattern).then(() => {
					if (request.hideDialog === true)
						whiteList.hideWhiteListDialog(sender.tab.id, { goBack: true });

					SettingsPageController.reloadSettings().then(() => {
						setTimeout(function() {
							new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
						}, 500);
					}).catch(console.error);
				}).catch(console.error);

				sendResponse({ tabId: sender.tab.id });
			} else if (request.method === '[AutomaticTabCleaner:removeUrlFromWhitelist]') {
				void whiteList.removeUrlFromWhitelist(request.url);
			} else if (request.method === '[AutomaticTabCleaner:donate]') {
				/*google.payments.inapp.buy({
					'parameters': { 'env': 'prod' },
					'sku': 'ts_user_donation_level_4',
					'success': console.log,
					'failure': console.log
				});*/
				chrome.tabs.create({
					url: 'https://www.patreon.com/TabSuspender'
				}).catch(console.error);
			} else if (request.method === '[AutomaticTabCleaner:getFormRestoreDataAndRemove]') {
				formRestoreController.getFormRestoreDataAndRemove(sender.tab.id).then(data => {
					sendResponse(data);
				}).catch(console.error);
				return true; // For async sendResponse()
			} else if (request.method === '[AutomaticTabCleaner:DiscardTab]') {
				discardTab(sender.tab.id);
			} else if (request.method === '[AutomaticTabCleaner:UnmarkPageAsNonCompleteInput]') {
				tabManager.getTabInfoOrCreate(sender.tab).nonCmpltInput = false;
			} else if (request.method === '[AutomaticTabCleaner:MarkPageAsNonCompleteInput]') {
				tabManager.getTabInfoOrCreate(sender.tab).nonCmpltInput = true;
			} else if (request.method === '[AutomaticTabCleaner:OpenSettingsPage]') {
				SettingsPageController.openSettings();
			} else if (request.method === '[AutomaticTabCleaner:OpenPopup]') {
				window.open(chrome.runtime.getURL('popup.html'), "extension_popup");
			}else if (request.method === '[AutomaticTabCleaner:ReloadSettings]') {
				if (debug)
					console.log(request.method);
				SettingsPageController.reloadSettings({ fromSettingsPage: true }).catch(console.error);
			} else if (request.method === '[AutomaticTabCleaner:resetAllSettings]') {
				settings.removeAll().then(()=>{
					settings = new SettingsStore(SETTINGS_STORAGE_NAMESPACE, DEFAULT_SETTINGS, offscreenDocumentProvider);
					LocalStore.set(LocalStoreKeys.INSTALLED, true).catch(console.error);
					SettingsPageController.reloadSettings(/*{fromSettingsPage: true}*/).catch(console.error);
				}).catch(console.error);
			} else if (request.method === '[AutomaticTabCleaner:exportAllSettings]') {
				sendResponse({settings: JSON.stringify(settings.toObject(), null, 2)});
			} else if (request.method === '[AutomaticTabCleaner:importAllSettings]') {
				settings.removeAll().then(()=>{
					settings = new SettingsStore(SETTINGS_STORAGE_NAMESPACE, { ...DEFAULT_SETTINGS, ...request.settings }, offscreenDocumentProvider);
					LocalStore.set(LocalStoreKeys.INSTALLED, true).catch(console.error);
					SettingsPageController.reloadSettings(/*{fromSettingsPage: true}*/).catch(console.error);
				}).catch(console.error);
			} else if (request.method === '[TS:getSessionPageConfig]') {
				sendResponse({TSSessionId});
			} else {
				console.error(`Unimplemented message ${request.method}`);
			}
		});
	}
}