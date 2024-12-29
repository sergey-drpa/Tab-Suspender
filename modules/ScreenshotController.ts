// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ScreenshotController {

	private static debug = true;

	static isScreenExist(tabId: number, sessionId, callback) {

		//tabId = tabManager.findReplacedTabId(tabId);

		if (sessionId == null)
			sessionId = TSSessionId;

		database.queryIndexCount(
			{
				IDB:
					{
						table: 'screens',
						index: 'PK'
					},
				WebSQL:
					{
						//query: 'select count(*) from screens where id = ? and sessionId = ?'
					},
				params: [tabId, parseInt(sessionId)]
			},
			callback
		);
	}

	static getScreen(id, sessionId, callback) {

		//id = tabManager.findReplacedTabId(id);

		if (debugScreenCache)
			console.log('getScreen called for tabId: ' + id, Date.now());

		if (database.isInitialized() != true) {
			console.log('getScreen DB is not initialized yet waiting...: ' + id, Date.now());
			database.getInitializedPromise().then(function() {
				// eslint-disable-next-line no-undef
				ScreenshotController.getScreen(id, sessionId, callback);
			});
			return;
		}

		if (sessionId == null) {
			sessionId = TSSessionId;
		}

		if (getScreenCache != null) {
			if (getScreenCache.sessionId == sessionId && getScreenCache.tabId == id) {
				getScreenCache.getScreenPromise.then(function() {
					if (debugScreenCache)
						console.log('getScreen then handler added');
					callback(getScreenCache.screen, getScreenCache.pixRat);
					getScreenCache = null;
					if (debugScreenCache)
						console.log('Screen got from cache!!');
				});
				return;
			} else
				getScreenCache = null;
		}

		const currentDB = database;

		currentDB.queryIndex(
			{
				IDB:
					{
						table: 'screens',
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

	static addScreen(id, screen, devicePixelRatio) {

		if (ScreenshotController.debug)
			console.warn(`addScreen(${id}, ${screen.length}b, ${devicePixelRatio}pr)`);

		if (screen != null) {
			if (devicePixelRatio == null) {
				console.warn('addScreen(): devicePixelRatio is null!!!');
			}

			const metadata =
				{
					'id': parseInt(id),
					'sessionId': TSSessionId,
					'added_on': new Date(),
					'screen': screen,
					'pixRat': devicePixelRatio
				};

			database.putV2([
					{
						IDB:
							{
								table: 'screens',
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