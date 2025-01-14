chrome.runtime.onStartup.addListener(() => {
	console.log(`onStartup()`);
});

try {
	importScripts(
		'utils.js',
		'modules/Settings.js',
		'modules/LocalStore.js',
		'modules/TSKeeper.js',
		'modules/errorsProcessing.js',
		'background.pre.js',
		'fancy-settings/source/lib/store.js',
		'modules/IndexedDBProvider.js',
		'modules/DBProvider.js',
		'modules/TabManager.js',
		'modules/TabCapture.js',
		'modules/TabObserver.js',
		'modules/TabParkController.js',
		'modules/ScreenshotController.js',
		'modules/WindowManager.js',
		'modules/model/TabInfo.js',
		'modules/WhiteList.js',
		'modules/IgnoreList.js',
		'modules/ContextMenuController.js',
		'modules/BrowserActionControl.js',
		'modules/PageStateRestoreController.js',
		'modules/HistoryOpenerController.js',
		'modules/SettingsPageController.js',
		'modules/PopupController.js',
		'modules/BGMessageListener.js',
		'modules/pageOpener.js',
		'modules/DbUtils.js',
		'modules/OffscreenDocumentProvider.js',
		'background.js'
	);
} catch (e) {
	console.error(e);
}