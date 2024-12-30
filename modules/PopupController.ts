interface PopupQueryBGResponse {
	successful: boolean;
	tabId: number;
	allowed: boolean;
	TSSessionId: number;
	active: boolean;
	timeout: number;
	parked: boolean;
	pauseTics: number;
	pauseTicsStartedFrom: number;
	isTabInIgnoreTabList: boolean;
	isTabInWhiteList: boolean;
	isCloseTabsOn: any;
	closeTimeout: number;
	limitOfOpenedTabs: any;
	TSVersion: string;
	sendErrors: any;
	popup_showWindowSessionByDefault: any;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function popupQuery(tab) {
	if (debug)
		console.log('popupQuery Requested.');

	const tabURLAllowedForPark = TabManager.isTabURLAllowedForPark(tab);
	let parked;
	try {
		parked = tabManager.getTabInfoOrCreate(tab).parked;
		// eslint-disable-next-line no-empty
	} catch (e) {
		// normal behavior
		console.trace(e);
	}

	if (debug)
		console.log('Park alowed: ' + tabURLAllowedForPark, 'parked: ', parked == true, tab);

	return <PopupQueryBGResponse>{
		successful: true,
		tabId: tab.id,
		allowed: tabURLAllowedForPark,
		TSSessionId,
		active: await settings.get('active'),
		timeout: await settings.get('timeout'),
		parked: parked == true,
		pauseTics: pauseTics,
		pauseTicsStartedFrom:
		pauseTicsStartedFrom,
		// eslint-disable-next-line no-undef
		isTabInIgnoreTabList: ignoreList.isTabInIgnoreTabList(tab.id),
		// eslint-disable-next-line no-undef
		isTabInWhiteList: (parked ? whiteList.isURIException(parseUrlParam(tab.url, 'url')) : whiteList.isURIException(tab.url)),
		isCloseTabsOn: await settings.get('isCloseTabsOn'),
		closeTimeout: await settings.get('closeTimeout'),
		limitOfOpenedTabs: await settings.get('limitOfOpenedTabs'),
		TSVersion: chrome.runtime.getManifest().version,
		sendErrors: await settings.get('sendErrors'),
		popup_showWindowSessionByDefault: await settings.get('popup_showWindowSessionByDefault'),
	};
}