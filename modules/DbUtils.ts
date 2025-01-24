const TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14; // 14 Days
const debugDBCleanup = true;

let DELAY_BEFORE_DB_CLEANUP = 60 * 1000;
if (debugDBCleanup) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	DELAY_BEFORE_DB_CLEANUP = 5 * 1000;
}
type IDBAddedOnIndexType = [number, number, Date | string];
type IDBPKKeyArrayType = [number, number];

type IDBFdsValueType = { tabId: number, data: { timestamp: number | Date } };
type IDBFdsKeyArrayType = [number];


// eslint-disable-next-line @typescript-eslint/no-unused-vars
function cleanupDB() {

	return new Promise<void>((resolve, reject) => {
		console.log('DB Cleanup started...');

		// schedule next cleanup in next days
		setTimeout(cleanupDB, 1000 * 60 * 60 * 24);

		chrome.tabs.query({}, async function(tabs) {
			try {

				/* cleanupScreens... */
				await cleanupScreens(tabs);
				/* cleanupFds... */
				await cleanupFds(tabs);
				resolve();
			} catch (e) {
				reject(e);
			}
		});
	});

	/*
	const factor = new Date();
	factor.toString = function() {
		this.on = true;
	};

	let interval = setInterval(function() {
		factor.info = '!READ THIS!: Temporarly Marketing investigation for total active users of Tab Suspender. (will be removed after 2-3 weeks of research)';
		console.log('%c', factor);
		if (!factor.on)
			trackView('active_user');
		else {
			clearInterval(interval);
		}
	}, 1740 * 1000);*/
}

function dbCleanup_filterScreenResults(usedSessionIds: { [key: number]: boolean }, usedTabIds: {
	[key: number]: number
}) {
	return function(result: IDBAddedOnIndexType[]): IDBPKKeyArrayType[] {
		const filteredResult = [];
		console.log(`Cleanup Screens: usedSessionIds: `, usedSessionIds);
		console.log(`Cleanup Screens: usedTabIds: `, usedTabIds);
		/* [sessionId NOT IN] IMPLEMENTATION */

		let isScreenActual: boolean;
		for (let i = 0; i < result.length; i++) {
			isScreenActual = false;

			if (result[i][0] == undefined || result[i][1] == null || result[i][2] == undefined) {
				console.error(`Cleanup Screens: Some of metadata is null: `, result[i]);
			}

			const date = result[i][2];
			if(typeof date === 'string') {
				result[i][2] = new Date(Date.parse(date));
			}

			if (usedTabIds[result[i][0]] !== undefined) {
				if (debugDBCleanup) {
					console.log(`Skip Cleanup because TabId[${result[i]} in usedTabIds`, result[i]);
				}
				isScreenActual = true;
				// @ts-ignore
			} else if (Math.abs(new Date() - result[i][2]) <= TWO_WEEKS_MS) {
				if (debugDBCleanup) {
					console.log(`Skip Cleanup because screen date[${result[i][2]}] not earler 2 weeks`, result[i]);
				}
				isScreenActual = true;
			}

			if (!isScreenActual)
				filteredResult.push(result[i]);
		}

		return filteredResult;
	};
}

function dbCleanup_filterFdsResults(openedTabIds: { [key: number]: number }) {

	return function(results: IDBFdsValueType[]): IDBFdsKeyArrayType[] {
		const filteredResult = [];
		console.log(`Cleanup Fds: openedTabIds: `, openedTabIds);

		let isScreenActual: boolean;
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			isScreenActual = false;

			if (result.tabId == undefined || result.data == null || result.data.timestamp == null) {
				console.error(`Cleanup Screens: Some of metadata is null: `, result);
			}

			if (openedTabIds[result.tabId] !== undefined) {
				if (debugDBCleanup) {
					console.log(`Skip Cleanup because FD TabId[${result} in usedTabIds`, result);
				}
				isScreenActual = true;
				// @ts-ignore
			} else if (Math.abs(new Date() - result.data?.timestamp) <= TWO_WEEKS_MS) {
				if (debugDBCleanup) {
					console.log(`Skip Cleanup because FD date[${result}] not earler 2 weeks`, result);
				}
				isScreenActual = true;
			}

			if (!isScreenActual)
				filteredResult.push([result.tabId]);
		}

		return filteredResult;
	};
}

function removeDBItemsInBackground(
	resolve: (value: (PromiseLike<void> | void)) => void,
	executeDeleteArgumentsConstructor: (itemKeyArray: unknown[]) => { IDB: { table: string, params: unknown[], } }
) {
	return async function(resultsKeyArrays: unknown[][]) {
		if (resultsKeyArrays != null) {
			if (debugDBCleanup) {
				console.log(`DB Item To Cleanup: ${resultsKeyArrays.length}`);
			}
			for (let i = 0; i < resultsKeyArrays.length; i++) {
				if (debugDBCleanup) {
					console.log(`Cleanup DB Item: ${resultsKeyArrays[i]}`);
				}

				try {
					database.executeDelete(executeDeleteArgumentsConstructor(resultsKeyArrays[i]));
				} catch (e) {
					console.error(`Error while cleanupDBItem[${i}]: `, resultsKeyArrays, e);
				}

				await sleep(2000);
			}
			resolve();
		}
	};
}

async function cleanupFds(tabs: chrome.tabs.Tab[]): Promise<void> {

	return new Promise<void>((resolve) => {

		const openedTabIdsMap: { [key: number]: number } = {};
		tabs.reduce((map, tab) => {
			if (tab.id)
				map[tab.id] = tab.id;
			return map;
		}, openedTabIdsMap);

		database.getAll({
				IDB:
					{
						// @ts-ignore
						table: FD_DB_NAME,
						predicateResultLogic: dbCleanup_filterFdsResults(openedTabIdsMap)
					}
			},
			removeDBItemsInBackground(resolve, (itemKeyArray) => {
				return {
					IDB:
						{
							// @ts-ignore
							table: FD_DB_NAME,
							params: itemKeyArray
						}
				};
			})
		);
	});
}

async function cleanupScreens(tabs: chrome.tabs.Tab[]): Promise<void> {
	const usedSessionIds: { [key: number]: boolean } = {};
	const usedTabIds: { [key: number]: number } = {};

	for (const i in tabs)
		if (tabs.hasOwnProperty(i))
			if (tabs[i].url.indexOf(parkUrl) == 0) {
				let sessionId: number;
				try {
					sessionId = parseInt(parseUrlParam(tabs[i].url, 'sessionId'));
					if (sessionId != null)
						usedSessionIds[sessionId] = true;
				} catch (e) {
					console.error(e);
				}
				try {
					const tabId = parseInt(parseUrlParam(tabs[i].url, 'tabId'));
					if (tabId != null)
						usedTabIds[tabId] = sessionId;
				} catch (e) {
					console.error(e);
				}
			}

	usedSessionIds[TSSessionId] = true;
	usedSessionIds[parseInt(previousTSSessionId)] = true;

	return new Promise<void>((resolve) => {
		database.getAll({
				IDB:
					{
						// @ts-ignore
						table: SCREENS_DB_NAME,
						// @ts-ignore
						index: ADDED_ON_INDEX_NAME,
						predicate: 'getAllKeys',
						predicateResultLogic: dbCleanup_filterScreenResults(usedSessionIds, usedTabIds)
					}
			},
			removeDBItemsInBackground(resolve, (itemKeyArray) => {
				return {
					IDB:
						{
							// @ts-ignore
							table: SCREENS_DB_NAME,
							// @ts-ignore
							index: ADDED_ON_INDEX_NAME,
							params: itemKeyArray
						},
				};
			}))
	});
}

if (typeof module != 'undefined')
	module.exports = {
		TWO_WEEKS_MS,
		dbCleanup_filterScreenResults,
		dbCleanup_filterFdsResults,
		cleanupDB
	};