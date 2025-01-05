const TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14;
const debugDBCleanup = true;

let DELAY_BEFORE_DB_CLEANUP = 60 * 1000;
if(debugDBCleanup) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	DELAY_BEFORE_DB_CLEANUP = 5 * 1000;
}
type AddedOnIndexKeyType = [number, number, Date];

function dbCleanup_filterScreenResults(usedSessionIds: {[key: number]: boolean}, usedTabIds: {[key: number]: number}) {
	// TODO-v3: Need  to add tests to next function - Buggy (Maybe should ignore no only by session+tabId, but by tabId to)
	return function(result: AddedOnIndexKeyType[]) {
		const filtredResult = [];
		const filterdSessionKeysArray = Object.keys(usedSessionIds);
		console.log(`Cleanup Screens: filterdSessionKeysArray: `, filterdSessionKeysArray);
		/* [sessionId NOT IN] IMPLEMENTATION */
		let isScreenActual;
		for (let i = 0; i < result.length; i++) {
			isScreenActual = false;

			if (result[i][0] == undefined || result[i][1] == null || result[i][2] == undefined) {
				console.error(`Cleanup Screens: Some of metadata is null: `, result[i]);
			}

			if (usedSessionIds[result[i][1]] !== undefined || usedTabIds[result[i][0]] !== undefined) {
				if (usedTabIds[result[i][0]] !== undefined) {
					isScreenActual = true;
					// @ts-ignore
					// TODO: result[i][2] is not working - need to iterate by value with ts instead key where no ts
				} else if (Math.abs(new Date() - result[i][2]) > TWO_WEEKS_MS) {
					isScreenActual = false;
				} else {
					isScreenActual = true;
				}
			}

			if (!isScreenActual)
				filtredResult.push(result[i]);
		}

		return filtredResult;
	};
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function cleanupDB() {
	console.log('DB Cleanup started...');

	// schedule next cleanup in next days
	setTimeout(cleanupDB, 1000 * 60 * 60 * 24);

	const usedSessionIds: {[key: number]: boolean} = {};
	const usedTabIds:{[key: number]: number} = {};

	chrome.tabs.query({}, function(tabs) {
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

		database.getAll({
			IDB:
				{
					table: 'screens',
					index: ADDED_ON_INDEX_NAME,
					predicate: 'getAllKeys',
					predicateResultLogic: dbCleanup_filterScreenResults(usedSessionIds, usedTabIds),
				},
			WebSQL:
				{
					//query: 'select sessionId from screens where sessionId NOT IN ("' + Object.keys(usedSessionIds).join('","') + '") group by sessionId',
					//params: null
				}

		}, function(resultsRowsArray) {
			if (resultsRowsArray != null) {
				if (debugDBCleanup) {
					console.log(`ScreensToCleanup: ${resultsRowsArray.length}`);
				}
				for (let i = 0; i < resultsRowsArray.length; i++) {
					const callDelete = function(curI) {
						setTimeout(function() {

							if (debugDBCleanup) {
								console.log(`Cleanup Screenshot: ${resultsRowsArray[curI]}`);
							}

							database.executeDelete({
								IDB:
									{
										table: 'screens',
										index: 'PK',
										params: [resultsRowsArray[curI][0], resultsRowsArray[curI][1]]
									},
								WebSQL:
									{
										//query: 'delete from screens where sessionId = ?',
										//params: [resultsRowsArray[curI].sessionId]
									}
							});
						}, 2000 * curI);
					};

					callDelete(i);
				}
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

if (typeof module != "undefined")
	module.exports = {
		TWO_WEEKS_MS,
		dbCleanup_filterScreenResults,
		cleanupDB,
	};