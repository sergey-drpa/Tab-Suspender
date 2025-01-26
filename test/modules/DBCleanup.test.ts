// eslint-disable-next-line @typescript-eslint/no-require-imports
// @ts-ignore
import QueryInfo = chrome.tabs.QueryInfo;
// @ts-ignore
import Tab = chrome.tabs.Tab;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("fake-indexeddb/auto");




describe('DBCleanup Tests', () => {

	it('IDB integration test', async () => {

		global.chrome = {
			// @ts-ignore
			tabs: {
				// @ts-ignore
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				query: function query(queryInfo: QueryInfo, callback: (result: Tab[]) => void): void {
					callback([
						// @ts-ignore
						{id: 1, url: parkUrl },
						// @ts-ignore
						{id: 2, url: 'http://google.com'},
						// @ts-ignore
						{id: 3, url: parkUrl },
					]);
				}
			}
		};

		// @ts-ignore
		global.database = new DBProvider('IndexedDB');

		ScreenshotController.addScreen(1, "data:image/jpeg;base64,dklfnkldnfdkfjdiosf", 2, new Date(new Date().getTime()-TWO_WEEKS_MS));
		const secondScreenDate = new Date();
		ScreenshotController.addScreen(2, "data:image/jpeg;base64,dklfnkldnfdkfjdiosf2", 2, secondScreenDate);
		const oneWeekScreenDate = new Date(new Date().getTime()-TWO_WEEKS_MS + 1000*60*60*24*7);
		ScreenshotController.addScreen(3, "data:image/jpeg;base64,dklfnkldnfdkfjdiosf3", 2, oneWeekScreenDate);
		await sleep(100);

		await cleanupDB();

		// @ts-ignore
		database.getAll({
			IDB:
				{
					// @ts-ignore
					table: SCREENS_DB_NAME,
				}
		}, (leftScreens) => {
			console.log(`screens: `, leftScreens);

			expect(leftScreens).toStrictEqual([{
				"id": 2,
				"sessionId": TSSessionId,
				"added_on": secondScreenDate.toISOString(),
				"screen": "data:image/jpeg;base64,dklfnkldnfdkfjdiosf2",
				"pixRat": 2
			},
			{
				"id": 3,
				"sessionId": TSSessionId,
				"added_on": oneWeekScreenDate.toISOString(),
				"screen": "data:image/jpeg;base64,dklfnkldnfdkfjdiosf3",
				"pixRat": 2
			}
			]);
		});

		await sleep(100);
	});

	it('Test two unused screens should be removed (without dates)', async () => {

		const usedSessionIds: { [sessionId: number]: boolean } = {
			222: true,
			333: true
		};
		const usedTabIds: { [tabId: number]: number } = {
			// tabId: sessionId
			1: 0,
			2: 222,
			3: 222,
			4: 333
		};

		const screensFromDb: IDBAddedOnIndexType[] = [
			// [tabId, sessionId]
			[0, 0, null], // <- Should be deleted/returned
			[1, 0, null],
			[5, 111, null], // <- Should be deleted/returned
			[2, 222, null],
			[3, 222, null],
			[4, 333, null]
		];

		const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
		const result = filterFunction.apply(null, [screensFromDb]);

		console.log(`Results: `, result);

		expect(result).toStrictEqual([
			[0, 0, null],
			[5, 111, null]
		]);
	});


	it('Test two unused screens should be removed by expire', () => {

		const usedSessionIds: { [sessionId: number]: boolean } = {
			222: true,
			333: true
		};
		const usedTabIds: { [tabId: number]: number } = {
			// tabId: sessionId
			1: 0,
			2: 222,
			3: 222
			//4: 333,
		};

		const today = new Date();
		const dayMs = 86400000;

		const screensFromDb: IDBAddedOnIndexType[] = [
			// [tabId, sessionId]
			[0, 0, today],
			[0, 100, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[1, 0, new Date(today.getTime() - (5 * dayMs))],
			[5, 111, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[2, 222, new Date(today.getTime() - (7 * dayMs))],
			// Should be not deleted by expired > 2 weeks cause tabId 3 exists in usedTabIds
			[3, 222, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))],
			[4, 333, new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[6, 333, new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs))],
			// No tabId and sessionId correlation but earler 2 weeks - do not delete
			[7, 444, new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs))]
		];

		console.log(`screensFromDb: `, screensFromDb);

		const filterFunction = dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
		const result = filterFunction.apply(null, [screensFromDb]);

		console.log(`Results: `, result);

		expect(result).toStrictEqual([
			[0, 100, expect.any(Date)],
			[5, 111, expect.any(Date)],
			[4, 333, expect.any(Date)]
		]);
	});


	it('Test expired FDs should be removed by expire', () => {

		const openedTabIds: { [tabId: number]: number } = {
			// tabId: tabId
			1: 1,
			2: 2,
			3: 3
		};

		const today = new Date();
		const dayMs = 86400000;

		const fdsFromDb: IDBFdsValueType[] = [
			// [tabId, sessionId]
			{ tabId: 0, data: { timestamp: today } },
			{ tabId: 0, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // <- Should be deleted/returned as expired
			{ tabId: 1, data: { timestamp: new Date(today.getTime() - (5 * dayMs)) } },
			{ tabId: 5, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // <- Should be deleted/returned as expired
			{ tabId: 2, data: { timestamp: new Date(today.getTime() - (7 * dayMs)) } },
			// Should be not deleted by expired > 2 weeks cause tabId 3 exists in openedTabIds
			{ tabId: 3, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } },
			{ tabId: 4, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS + 1 * dayMs)) } }, // <- Should be deleted/returned as expired
			{ tabId: 6, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs)) } },
			// No tabId and sessionId correlation but earler 2 weeks - do not delete
			{ tabId: 7, data: { timestamp: new Date(today.getTime() - (TWO_WEEKS_MS - 1 * dayMs)) } }
		];

		// Case for timestamp in number Type
		fdsFromDb.forEach((iDBFdsValueType: IDBFdsValueType) => {
			const copy = JSON.parse(JSON.stringify(iDBFdsValueType));
			// @ts-ignore
			copy.data.timestamp = Date.parse(copy.data.timestamp);
			fdsFromDb.push(copy);
		});

		console.log(`fdsFromDb: `, fdsFromDb);

		const filterFunction = dbCleanup_filterFdsResults(openedTabIds);
		const result: IDBFdsKeyArrayType = filterFunction.apply(null, [fdsFromDb]);

		console.log(`Results: `, result);

		expect(result).toStrictEqual([
			[0],
			[5],
			[4],
			[0],
			[5],
			[4]
		]);
	});
});