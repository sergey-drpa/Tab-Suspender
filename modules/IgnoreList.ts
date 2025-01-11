// eslint-disable-next-line @typescript-eslint/no-unused-vars
class IgnoreList {

	private readonly ignoreTabList = {};

	addToIgnoreTabList(tabId) {
		this.ignoreTabList[tabId] = true;

		/* TODO-v4: Why BrowserActionControl() do not receive ignoreTabList? */
		new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
	}

	isTabInIgnoreTabList(tabId) {
		return this.ignoreTabList[tabId] != null;
	};

	removeFromIgnoreTabList(tabId) {
		delete this.ignoreTabList[tabId];

		new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
	}
}