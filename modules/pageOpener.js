
function focusOrOpenTSPage(pageLocalUrl, options) {
	chrome.windows.getCurrent({ 'populate': true }, function(currentWindow) {
		for (let i = 0; i <= currentWindow.tabs.length; i++) {
			const tab = currentWindow.tabs[i];
			if (tab && tab.url.indexOf(chrome.extension.getURL(pageLocalUrl)) === 0) {
				if (tab.active)
					chrome.tabs.reload(tab.id, {});
				else if (options == null || options.reloadOnly == null || options.reloadOnly === false)
					chrome.tabs.update(tab.id, { 'active': true });
				break;
			} else if (i === currentWindow.tabs.length - 1) {
				// Create new tab if past end of list and none open
				if (options == null || options.reloadOnly == null || options.reloadOnly === false)
					chrome.tabs.create({ 'url': pageLocalUrl, 'active': true });
			}
		}
	});
}
