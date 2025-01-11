import Reason = chrome.offscreen.Reason;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class OffscreenDocumentProvider {

	private readonly documentCreatedPromise: Promise<void>;

	constructor() {
		this.documentCreatedPromise = new Promise<void>(async (resolve, reject) => {

			await new Promise(r => setTimeout(r, 1500));

			chrome.offscreen.createDocument({
				url: 'offscreenDocument.html',
				reasons: [Reason.LOCAL_STORAGE, Reason.BATTERY_STATUS],
				justification: 'Need to migrate from localStorage and battery status'
			}).then(() => { resolve(); })
				.catch((error) => { console.error(error);  reject(); });
			console.log(`Offscreen Document Creating...`);
		});
	}

	async extractOldSettings(settingsKeys: string[]) {

		console.log('ExtractOldSettings started...');

		await this.documentCreatedPromise;

		const localStorageData = await chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:getLocalStorageData]',
			settingsKeys
		});

		console.log('LocalStorageData: ', localStorageData);

		/*chrome.offscreen.closeDocument(() => {
			console.log('OffscreenDocument closed.');
		});*/

		return localStorageData;
	}

	async cleanupFormDatas() {
		return new Promise<void>(async resolve => {

			console.log('CleanupFormDatas started...');

			await this.documentCreatedPromise;

			const messageListener = (message) => {
				if (message.method === '[TS:offscreenDocument:cleanupComplete]') {
					console.log(`CleanupFormDatas - Complete.`);
					/*chrome.offscreen.closeDocument(() => {
						console.log('offscreenDocument closed.');
					});
					chrome.runtime.onMessage.removeListener(messageListener);*/
					resolve();
				}
			};

			chrome.runtime.onMessage.addListener(messageListener);

			/*await chrome.offscreen.createDocument({
				url: 'offscreenDocument.html',
				reasons: [Reason.LOCAL_STORAGE],
				justification: 'reason for needing the document'
			});*/

			await chrome.runtime.sendMessage({
				method: '[TS:offscreenDocument:startFormDatasCleanup]'
			});
		});
	}
}