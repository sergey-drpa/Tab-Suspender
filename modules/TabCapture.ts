const rootExtensionUri = chrome.runtime.getURL('');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TabCapture {

	private tabManager: TabManager;

	constructor(tabManager: TabManager) {
		this.tabManager = tabManager;
	}

	static lastWindowDevicePixelRatio: { [key: number]: number } = {};

	async captureTab(tab: chrome.tabs.Tab, options?): Promise<void> {

			if (options == null || options.checkActiveTabNotChanged != true)
				return this._captureTab(tab, options);
			else {
				const tab_ = await chrome.tabs.get(tab.id); //, function(tab) {

				if (tab_ != null)
					return this._captureTab(tab_, options);
				else
					throw new Error('Tab not found');
			}
	}

	private _captureTab(tab: chrome.tabs.Tab, options?): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		if (debug)
			console.log("_captureTab()...");

		return new Promise<void>(function(resolve, reject) {
			try {
				chrome.tabs.query({ currentWindow: true, active: true }, async function(tabsResult) {
					const tabInfo = self.tabManager.getTabInfoOrCreate(tab);

					if (tabsResult.length > 0 && tabsResult[0] != null) {
						const actualTab = tabsResult[0];

						if (!TabManager.isTabURLAllowedForPark(actualTab)) {
							// Do not need to capture this tab
							resolve();
							return;
						}

						if (actualTab.id !== tab.id) {
							console.warn(`Active tab to Capture already changed [${tab.id}] != [${actualTab.id}]`, {...actualTab, favIconUrl: undefined});
							reject(new Error(`Active tab changed [${tab.id}] != [${actualTab.id}]`));
							return;
						}

						if (actualTab.url !== tab.url) {
							console.warn(`Active tab URL to Capture already changed [${tab.url}] != [${actualTab.url}]`, {...actualTab, favIconUrl: undefined});
							reject(new Error(`Active tab URL changed [${tab.url}] != [${actualTab.url}]`));
							return;
						}

						if (actualTab.status !== "complete" && (options == null || !options.tryEvenIncomplete)) {
							console.warn(`Active tab is not complete[${actualTab.status}], skipping capture`, {...actualTab, favIconUrl: undefined});
							reject(new Error(`Active tab is not complete[${actualTab.status}]`));
							return;
						}

						if (tab.url.indexOf(rootExtensionUri) == 0 || actualTab.url.indexOf(rootExtensionUri) == 0) {
							// Do not need to capture self extension pages
							resolve();
							return;
						}

						if (tab.active === true) {
							tabManager.getTabInfoOrCreate(tab);

							// Check if screenshots are disabled
							if (!(await settings.get('screenshotsEnabled'))) {
								resolve(); // Skip capture when screenshots are disabled
								return;
							}

							if (tab.status != null && (tab.status !== 'loading' || (options != null && options.tryEvenIncomplete)))
								try {
									chrome.tabs.captureVisibleTab(tab.windowId, <chrome.tabs.CaptureVisibleTabOptions>{
										format: 'jpeg',
										quality: parseInt(await settings.get('screenshotQuality')), // TODO-v4: Cache settings.get('screenshotQuality')
									}, function(screen: string) {

										if (screen == null || screen == '') {
											console.warn(new Error(`Empty screen captures!!! id: ${tab.id}`), {...actualTab, favIconUrl: undefined});
											reject(new Error(`Empty screen captures!!! id: ${tab.id}`));
											return;
										}

										if (screen === 'data:,') {
											console.error(new Error(`Damaged screen [data:,]!!!`), {...actualTab, favIconUrl: undefined});
											reject(new Error(`Damaged screen [data:,]!!!`));
											return;
										}

										if (debug)
											console.trace(`_captureTab()->captured... ${screen.length}`);

										if (hasLastError([
											'This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.',
											'The \'activeTab\' permission is not in effect because this extension has not been in invoked.',
											/*'Cannot access contents of url "". Extension manifest must request permission to access this host.',
											'Cannot access contents of url "file:///". Extension manifest must request permission to access this host.',
											'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',*/
											'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
											'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab',
											'RegExp:Cannot access contents of url "' + rootExtensionUri + '.*',
											'RegExp:No window with id: \\d{1,5}\\.',
											'Failed to capture tab: view is invisible',
											'No active web contents to capture',
											'Cannot access a chrome:// URL'])) {
											try {
												reject(new Error('Capture failed due to Chrome API error'));
												return;
												// eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
											} catch (e) {
												// normal behavior
												console.trace(e);
											}
											return;
										}

										try {
											chrome.tabs.getZoom(tab.id, function(zoomFactor) {
												tabInfo.zoomFactor = zoomFactor;
											});
										} catch (e) {
											console.warn("Error while fetching tab Zoom:", e);
										}

										if (TabManager.canTabBeScripted(tab)) {
											chrome.scripting.executeScript({
												target: { tabId: tab.id },
												func: () => {
													return window.devicePixelRatio;
												}
											}).then(async (result) => {
												try {
													const returnedDevicePixelRatio = result[0].result;
													let devicePixelRatio;
													if (returnedDevicePixelRatio == null)
														devicePixelRatio = TabCapture.lastWindowDevicePixelRatio[tab.windowId];
													else
														TabCapture.lastWindowDevicePixelRatio[tab.windowId] = devicePixelRatio = returnedDevicePixelRatio;

													await ScreenshotController.addScreen(tab.id, screen, devicePixelRatio);
													tabManager.setLastCaptureUrl(tab);

													if (debug)
														console.log(`_captureTab() -> captured -> saved!`);

													resolve();
													// eslint-disable-next-line no-empty
												} catch (e) {
													// normal behavior
													console.trace(e);
													reject(e);
												}
											})
												.catch((e) => {
													hasLastError(TabCapture.expectedInjectExceptions, e, `'return window.devicePixelRatio;', ActualTab: ${JSON.stringify({...actualTab, favIconUrl: undefined})}`);
													reject(e);
												});
										} else {
											console.error(new Error(`Tab canTabBeScripted`), {...actualTab, favIconUrl: undefined});
											reject(new Error(`Tab cannot be scripted`));
										}
									});
									// eslint-disable-next-line @typescript-eslint/no-unused-vars
								} catch (e) {
									// normal behavior
									console.error(e);
									reject(e);
									return;
								}

							return;
						}
						else {
							reject(new Error('Tab is not active'));
							return;
						}
					}
				});
			} catch (e) {
				console.error(e);
				reject(e);
			}
		});
	}

	public static readonly expectedInjectExceptions = [
		'The tab was closed.',
		'The extensions gallery cannot be scripted.',
		//'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',
		'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
		'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab',
		'Frame with ID 0 is showing error page',
	];

	injectJS(tabId: number, tab: chrome.tabs.Tab) {
		try {
			const closureId = tabId;

			if (!TabManager.canTabBeScripted(tab)) {
				// Can't inject to tab
				return;
			}

			if (tab.status === "unloaded") {
				// Can't inject to unloaded tab
				return;
			}

			chrome.scripting.executeScript({
				target: {tabId: closureId},
				files: ['lib/h2c.js', 'inject.js'],
			}).then(() => {
				hasLastError(TabCapture.expectedInjectExceptions);

				/*chrome.scripting.executeScript({
					target: {tabId: closureId},
					files: ['inject.js'],
				}).catch(e => {
					hasLastError(TabCapture.expectedInjectExceptions, e, `Error while injecting 'lib/inject.js', ActualTab: ${JSON.stringify({favIconUrl: undefined, ...tab})}`);
				});*/
			}).catch(e=> {
				hasLastError(TabCapture.expectedInjectExceptions, e, `Error while injecting 'lib/h2c.js', ActualTab: ${JSON.stringify({...tab, favIconUrl: undefined,})}`);
			});
		} catch (e) {
			console.error('injectJS exception', e);
		}
	}
}

if (typeof module != "undefined")
	module.exports = TabCapture;