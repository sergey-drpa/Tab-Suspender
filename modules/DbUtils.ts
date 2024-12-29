const TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14;
const debugDBCleanup = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function cleanupDB() {
	console.log('DB Cleanup started...');

	// schedule next cleanup in next days
	setTimeout(cleanupDB, 1000 * 60 * 60 * 24);

	const usedSessionIds = {};
	const usedTabIds = {};

	chrome.tabs.query({}, function(tabs) {
		for (const i in tabs)
			if (tabs.hasOwnProperty(i))
				if (tabs[i].url.indexOf(parkUrl) == 0) {
					const sessionId = parseUrlParam(tabs[i].url, 'sessionId');
					const tabId = parseUrlParam(tabs[i].url, 'tabId');
					if (sessionId != null)
						usedSessionIds[sessionId] = true;
					if (tabId != null)
						usedTabIds[tabId] = sessionId;
				}

		usedSessionIds[TSSessionId] = true;
		usedSessionIds[parseInt(previousTSSessionId)] = true;

		database.getAll({
			IDB:
				{
					table: 'screens',
					index: ADDED_ON_INDEX_NAME,
					predicate: 'getAllKeys',
					predicateResultLogic: function(result) {
						const filtredResult = [];
						const filterdSessionKeysArray = Object.keys(usedSessionIds);
						console.log(filterdSessionKeysArray);
						/* [sessionId NOT IN] IMPLEMENTATION */
						let isScreenActual;
						for (let i = 0; i < result.length; i++) {
							isScreenActual = false;

							if (usedSessionIds[result[i][1]]) {
								if (usedTabIds[result[i][0]]) {
									isScreenActual = true;
									// @ts-ignore
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
					}
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


	/* TODO-v3:
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