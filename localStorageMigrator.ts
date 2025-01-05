for (let i = 0; i < 50000; i++) {
	localStorage.setItem(`f_t${i}`, String(Math.random()));
}
console.log(`Total localStorage objects: ${Object.keys(localStorage).length}`);


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

		if (message.method === '[TS:offscreenDocument:getLocalStorageData]') {

			console.log(`[TS:offscreenDocument:getLocalStorageData]: ${message.settingsKeys}`);

			const oldSettings = {};
			for (const i in message.settingsKeys) {
				// Get old settings...
				console.log(`Key: ${message.settingsKeys[i]}`);
				oldSettings[message.settingsKeys[i]] = localStorage.getItem(message.settingsKeys[i]);
			}
			sendResponse(oldSettings);

		} else if (message.method === '[TS:offscreenDocument:startFormDatasCleanup]') {

			console.log(`[TS:offscreenDocument:startFormDatasCleanup]`);

			void cleanup();
		}
	}
);

async function cleanup() {
	console.log(`Starting f_t cleanup...`);
	let i = -1;
	for (const key in localStorage) {
		i++;
		// Cleaning f_t items...
		if (key.startsWith('f_t')) {
			localStorage.removeItem(key);
			if (i % 100 === 0) {
				console.log(`Cleaned ${i} f_t items`);
				await new Promise(r => setTimeout(r, 500));
			}
		}
	}

	void chrome.runtime.sendMessage({
		method: '[TS:offscreenDocument:cleanupComplete]'
	});

	console.log(`f_t cleanup completed.`);
}