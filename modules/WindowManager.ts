// eslint-disable-next-line @typescript-eslint/no-unused-vars
class WindowManager {
	constructor() {
		chrome.windows.onCreated.addListener(function() {
			tabObserver.settingsChanged();
		});
	}
}