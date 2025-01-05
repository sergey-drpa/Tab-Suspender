import Reason = chrome.offscreen.Reason;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class LocalStorageMigrator {

	async extractOldSettings(settingsKeys: string[]) {

		console.log('ExtractOldSettings started...');

		await chrome.offscreen.createDocument({
			url: 'localStorageMigrator.html',
			reasons: [Reason.LOCAL_STORAGE],
			justification: 'reason for needing the document'
		});

		const localStorageData = await chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:getLocalStorageData]',
			settingsKeys
		});

		console.log('LocalStorageData: ', localStorageData);

		chrome.offscreen.closeDocument(() => {
			console.log('OffscreenDocument closed.');
		});

		return localStorageData;
	}

	async cleanupFormDatas() {
		return new Promise<void>(async resolve => {

			console.log('CleanupFormDatas started...');

			const messageListener = (message) => {
				if (message.method === '[TS:offscreenDocument:cleanupComplete]') {
					console.log(`CleanupFormDatas - Complete.`);
					chrome.offscreen.closeDocument(() => {
						console.log('offscreenDocument closed.');
					});
					chrome.runtime.onMessage.removeListener(messageListener);
					resolve();
				}
			};

			chrome.runtime.onMessage.addListener(messageListener);

			await chrome.offscreen.createDocument({
				url: 'localStorageMigrator.html',
				reasons: [Reason.LOCAL_STORAGE],
				justification: 'reason for needing the document'
			});

			await chrome.runtime.sendMessage({
				method: '[TS:offscreenDocument:startFormDatasCleanup]'
			});
		});
	}
}