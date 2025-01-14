// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-unused-vars
const ADDED_ON_INDEX_NAME = require('../../modules/IndexedDBProvider').ADDED_ON_INDEX_NAME;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DbUtils = require('../../modules/DbUtils');


describe('DBCleanup Tests', () => {
	it('Test two unused screens should be removed (without dates)', async () => {

		const usedSessionIds: {[sessionId: number]: boolean} = {
			222: true,
			333: true,
		};
		const usedTabIds:{[tabId: number]: number} = {
			// tabId: sessionId
			1: 0,
			2: 222,
			3: 222,
			4: 333,
		};

		const screensFromDb: AddedOnIndexKeyType[] = [
			// [tabId, sessionId]
			[0, 0, null], // <- Should be deleted/returned
			[1, 0, null],
			[5, 111, null], // <- Should be deleted/returned
			[2, 222, null],
			[3, 222, null],
			[4, 333, null],
		];

		const filterFunction = DbUtils.dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
		const result = filterFunction.apply(null, [screensFromDb]);

		console.log(`Results: `, result);

		expect(result).toStrictEqual([
			[ 0, 0, null ],
			[ 5, 111, null ]
		]);
	});


	it('Test two unused screens should be removed by expire', () => {

		const usedSessionIds: {[sessionId: number]: boolean} = {
			222: true,
			333: true,
		};
		const usedTabIds:{[tabId: number]: number} = {
			// tabId: sessionId
			1: 0,
			2: 222,
			3: 222,
			//4: 333,
		};

		const today = new Date();
		const dayMs = 86400000;

		const screensFromDb: AddedOnIndexKeyType[] = [
			// [tabId, sessionId]
			[0, 0, today],
			[0, 100, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[1, 0, new Date(today.getTime() - (5 * dayMs))],
			[5, 111, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[2, 222, new Date(today.getTime() - (7 * dayMs))],
			// Should be not deleted by expired > 2 weeks cause tabId 3 exists in usedTabIds
			[3, 222, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS + 1 * dayMs))],
			[4, 333, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS + 1 * dayMs))], // <- Should be deleted/returned as expired
			[6, 333, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS - 1 * dayMs))],
			// No tabId and sessionId correlation but earler 2 weeks - do not delete
			[7, 444, new Date(today.getTime() - (DbUtils.TWO_WEEKS_MS - 1 * dayMs))],
		];

		console.log(`screensFromDb: `, screensFromDb);

		const filterFunction = DbUtils.dbCleanup_filterScreenResults(usedSessionIds, usedTabIds);
		const result = filterFunction.apply(null, [screensFromDb]);

		console.log(`Results: `, result);

		expect(result).toStrictEqual([
			[ 0, 100, expect.any(Date)],
			[ 5, 111, expect.any(Date) ],
			[ 4, 333, expect.any(Date) ],
		]);
	});
});