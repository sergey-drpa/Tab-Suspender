// debugScreenCache is declared globally

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ScreenshotController {

	private static debug = false;

	static isScreenExist(tabId: number, sessionId, callback) {

		//tabId = tabManager.findReplacedTabId(tabId);

		if (sessionId == null)
			sessionId = TSSessionId;

		database.queryIndexCount(
			{
				IDB:
					{
						// @ts-ignore
						table: SCREENS_DB_NAME,
						index: 'PK'
					},
				WebSQL:
					{
						//query: 'select count(*) from screens where id = ? and sessionId = ?'
					},
				params: [typeof tabId === 'string' ? parseInt(tabId) : tabId, parseInt(sessionId)]
			},
			callback
		);
	}

	static async getScreen(id, sessionId, callback, retryCount = 0) {
		const MAX_RETRIES = 3;
		const RETRY_TIMEOUT = 5000; // 5 seconds

		//id = tabManager.findReplacedTabId(id);

		if (debugScreenCache)
			console.log('getScreen called for tabId: ' + id, Date.now());

		// Check if screenshots are disabled
		if (!(await settings.get('screenshotsEnabled'))) {
			callback(null); // Return null when screenshots are disabled
			return;
		}

		if (database.isInitialized() != true) {
			if (retryCount >= MAX_RETRIES) {
				console.error('getScreen DB initialization failed after max retries for tabId:', id);
				callback(null);
				return;
			}

			console.log('getScreen DB is not initialized yet waiting...: ' + id, Date.now(), 'retry:', retryCount);

			const timeoutId = setTimeout(() => {
				console.warn('getScreen DB initialization timeout for tabId:', id, 'retry:', retryCount);
				void ScreenshotController.getScreen(id, sessionId, callback, retryCount + 1);
			}, RETRY_TIMEOUT);

			database.getInitializedPromise().then(function() {
				clearTimeout(timeoutId);
				void ScreenshotController.getScreen(id, sessionId, callback, retryCount);
			}).catch(function(error) {
				clearTimeout(timeoutId);
				console.error('getScreen DB initialization error for tabId:', id, 'error:', error, 'retry:', retryCount);
				void ScreenshotController.getScreen(id, sessionId, callback, retryCount + 1);
			});
			return;
		}

		if (sessionId == null) {
			sessionId = TSSessionId;
		}

		if (getScreenCache != null) {
			if (getScreenCache.sessionId == sessionId && getScreenCache.tabId == id) {
				// Check if cache is still being initialized (screen is null) to avoid deadlock
				if (getScreenCache.screen == null) {
					if (debugScreenCache)
						console.log('Cache is still initializing, skipping to avoid deadlock');
				} else {
					try {
						await getScreenCache.getScreenPromise;

						if (debugScreenCache)
							console.log('getScreen then handler added');
						callback(getScreenCache.screen, getScreenCache.pixRat);
						getScreenCache = null;
						if (debugScreenCache)
							console.log('Screen got from cache!!');
						return;
					} catch (e) {
						getScreenCache = null;
						if (debugScreenCache)
							console.error('getScreen cache promise failed:', e);
					}
				}
			} else
				getScreenCache = null;
		}

		database.queryIndex(
			{
				IDB:
					{
						// @ts-ignore
						table: SCREENS_DB_NAME,
						index: 'PK'
					},
				WebSQL:
					{
						/*query: 'select screen from screens where id = ? and sessionId = ?'*/
					},
				params: [parseInt(id), parseInt(sessionId)]
			},
			function(fields) {
				if (fields == null) {
					callback(null);
					return;
				}

				if (debugScreenCache)
					console.log('getScreen result: ', Date.now());
				callback(fields['screen'], fields['pixRat'] || 1);
			}
		);
	}

	static async addScreen(id: number | string, screen: string, devicePixelRatio: number, date?: Date): Promise<void> {

		if (ScreenshotController.debug)
			console.warn(`addScreen(${id}, ${screen.length}b, ${devicePixelRatio}pr)`);

		if (screen != null) {
			if (devicePixelRatio == null) {
				console.warn('addScreen(): devicePixelRatio is null!!!');
			}

			const metadata =
				{
					'id': typeof id === 'string' ? parseInt(id) : id,
					'sessionId': TSSessionId,
					'added_on': date ? date : new Date(),
					'screen': screen,
					'pixRat': devicePixelRatio
				};

			await database.putV2([
					{
						IDB:
							{
								// @ts-ignore
								table: SCREENS_DB_NAME,
								data: metadata
							}
					}/*,
					{
						IDB:
							{
								table: SCREENS_BINARY_DB_NAME,
								key: parseInt(id) + '|' + TSSessionId,
								data: atob(screen.substr(23))
							}
					}*/
				]
			);
		}
	}
}

if (typeof module != 'undefined')
	module.exports = {
		ScreenshotController,
	}