type BatteryStatusMessage = {
	isCharging: boolean;
	level: number;
};

const batteryDebug = false;
const oldSettingsKeyPrefix = "store.tabSuspenderSettings.";

setTimeout(startBatteryStatusNotifier, 3500);
setTimeout(startServiceWorkerHeartbeat, 4000);

function startServiceWorkerHeartbeat() {
	console.log('Starting service worker heartbeat from offscreen document...');

	// Send a heartbeat ping every 20 seconds to keep the service worker alive
	// This works because handling messages resets the service worker's idle timer
	setInterval(() => {
		chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:heartbeat]'
		}).catch((error) => {
			// Service worker might not be running yet, that's ok
			if (error.message !== 'Could not establish connection. Receiving end does not exist.') {
				console.error('Heartbeat error:', error);
			}
		});
	}, 20000); // Every 20 seconds

	console.log('Service worker heartbeat started');
}

function startBatteryStatusNotifier() {
	try {
		// @ts-ignore
		(navigator as (Navigator)).getBattery().then(function(battery) {
			battery.onchargingchange = function(event) {
				if (batteryDebug)
					console.log(`Charging event: ${event.target.charging}`);
				void chrome.runtime.sendMessage({
					method: '[TS:offscreenDocument:batteryStatusChanged]',
					battery: {
						isCharging: event.target.charging,
					} as BatteryStatusMessage,
				});
			};
			battery.onlevelchange = () => {
				if (batteryDebug)
					console.log(`Battery level event: ${battery.level}`);

				void chrome.runtime.sendMessage({
					method: '[TS:offscreenDocument:batteryStatusChanged]',
					battery: {
						level: battery.level,
					} as BatteryStatusMessage,
				});
			}

			console.log(`Startup Charging status: ${battery.charging}`);
			void chrome.runtime.sendMessage({
				method: '[TS:offscreenDocument:batteryStatusChanged]',
				battery: {
					isCharging: battery.charging
				} as BatteryStatusMessage,
			});
		});
	} catch (e) {
		console.log('navigator.getBattery() does not support by browser!', e);
	}
}

// @ts-ignore
Sentry.init({
	dsn: "https://d03bb30d517ec1594272cf217fc44f39@o4509192171945984.ingest.de.sentry.io/4509192186495056",
	allowUrls: [/.*/],
	integrations: (defaultIntegrations) => {
		// Remove browser session
		return defaultIntegrations.filter(
			(integration) => {
				console.log(`integration: `, integration);
				return integration.name !== "BrowserSession"
			},
		);
	},
});

function sendError(errorData) {
	const targetError = new Error(errorData.message);
	targetError.stack = errorData.stack;

	// @ts-ignore
	Sentry
		.captureException(targetError);
}

function sendEvent(event) {
	// @ts-ignore
	Sentry
		.captureEvent(event);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

		if (message.method === '[TS:offscreenDocument:heartbeatAck]') {
			// Heartbeat acknowledgment received from service worker
			// No action needed, this is just to confirm the connection
			return true;

		} else if (message.method === '[TS:offscreenDocument:sendError]') {

			console.log(`[TS:offscreenDocument:sendError]: ${message.type}`);

			if (message.type === 'error')
				sendError(message.error);
			else
				sendEvent(message.event);

		} else if (message.method === '[TS:offscreenDocument:getLocalStorageData]') {

			console.log(`[TS:offscreenDocument:getLocalStorageData]: ${message.settingsKeys}`);

			const oldSettings = {};
			for (const i in message.settingsKeys) {
				// Get old settings...
				console.log(`Key: ${message.settingsKeys[i]}`);
				//debugger;
				oldSettings[message.settingsKeys[i]] = localStorage.getItem(oldSettingsKeyPrefix + message.settingsKeys[i]);
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