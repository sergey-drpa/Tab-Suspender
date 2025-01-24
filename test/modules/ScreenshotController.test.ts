// eslint-disable-next-line @typescript-eslint/no-require-imports
// @ts-ignore
import QueryInfo = chrome.tabs.QueryInfo;
// @ts-ignore
import Tab = chrome.tabs.Tab;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('fake-indexeddb/auto');
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-unused-vars
//const ADDED_ON_INDEX_NAME = require('../../modules/IndexedDBProvider').ADDED_ON_INDEX_NAME;
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-require-imports
//const ScreenshotControllerModule = require('../../modules/ScreenshotController');


describe('ScreenshotController Tests', () => {

	it('AddScreen test', async () => {

		console.log(`Node Version: ${process.version}`);

		global.chrome = {
			// @ts-ignore
			tabs: {
				// @ts-ignore
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				query: function query(queryInfo: QueryInfo, callback: (result: Tab[]) => void): void {
					callback([
						// @ts-ignore
						{ id: 1, url: parkUrl },
						// @ts-ignore
						{ id: 2, url: 'http://google.com' }
					]);
				}
			}
		};

		// @ts-ignore
		global.database = new DBProvider('IndexedDB');


		ScreenshotController.addScreen(1, 'data:image/jpeg;base64,dklfnkldnfdkfjdiosf', 2);
		await sleep(500);

		ScreenshotController.getScreen(1, TSSessionId, (screen) => {
			console.log('getScreen: ', screen);
			expect(screen).toStrictEqual('data:image/jpeg;base64,dklfnkldnfdkfjdiosf');
		});

		await sleep(500);
	});
});