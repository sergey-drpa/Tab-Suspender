import Reason = chrome.offscreen.Reason;

/**
 * Manages the offscreen document lifecycle.
 *
 * IMPORTANT: The offscreen document is kept alive (not closed) after initialization
 * because it serves multiple purposes:
 * 1. Migrating localStorage data and monitoring battery status
 * 2. Keeping the MV3 service worker alive by sending periodic heartbeat messages
 *    (see offscreenDocument.ts:startServiceWorkerHeartbeat)
 * 3. Syncing suspended tabs to external backup via iframe
 *    (see offscreenDocument.ts:initBackupSync)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class OffscreenDocumentProvider {

	private readonly documentCreatedPromise: Promise<void>;

	constructor() {
		this.documentCreatedPromise = new Promise<void>(async (resolve, reject) => {

			await new Promise(r => setTimeout(r, 1500));

			try {
				// Check if an offscreen document already exists
				const hasDocument = await chrome.offscreen.hasDocument();

				if (hasDocument) {
					console.log('Offscreen Document already exists, skipping creation');
					resolve();
					return;
				}

				console.log('Offscreen Document Creating...');
				await chrome.offscreen.createDocument({
					url: 'offscreenDocument.html',
					reasons: [Reason.LOCAL_STORAGE, Reason.BATTERY_STATUS, Reason.IFRAME_SCRIPTING],
					justification: 'Need to migrate from localStorage, monitor battery status, and sync suspended tabs backup via iframe'
				});
				console.log('Offscreen Document Created successfully');
				resolve();
			} catch (error) {
				console.error('Error creating offscreen document:', error);
				reject(error);
			}
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

		// DO NOT close the offscreen document - it's needed for:
		// 1. Battery status monitoring
		// 2. Service worker heartbeat (keeps the service worker alive)
		// See class documentation for details

		return localStorageData;
	}

	async cleanupFormDatas() {
		return new Promise<void>(async resolve => {

			console.log('CleanupFormDatas started...');

			await this.documentCreatedPromise;

			const messageListener = (message) => {
				if (message.method === '[TS:offscreenDocument:cleanupComplete]') {
					console.log(`CleanupFormDatas - Complete.`);
					// DO NOT close the offscreen document - it's needed for service worker heartbeat
					chrome.runtime.onMessage.removeListener(messageListener);
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