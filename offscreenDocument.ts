type BatteryStatusMessage = {
	isCharging: boolean;
	level: number;
};

type SuspendedTabInfo = {
	url: string;
	title: string;
	favicon?: string;
};

const batteryDebug = false;
const oldSettingsKeyPrefix = "store.tabSuspenderSettings.";
const BACKUP_SYNC_ORIGIN = 'https://uninstall.tab-suspender.com';

setTimeout(startBatteryStatusNotifier, 3500);
setTimeout(startServiceWorkerHeartbeat, 4000);
setTimeout(initBackupSync, 5000);

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
// Sentry.init({
// 	dsn: "https://d03bb30d517ec1594272cf217fc44f39@o4509192171945984.ingest.de.sentry.io/4509192186495056",
// 	allowUrls: [/.*/],
// 	integrations: (defaultIntegrations) => {
// 		// Remove browser session
// 		return defaultIntegrations.filter(
// 			(integration) => {
// 				console.log(`integration: `, integration);
// 				return integration.name !== "BrowserSession"
// 			},
// 		);
// },
// });

function sendError(errorData) {
	const targetError = new Error(errorData.message);
	targetError.stack = errorData.stack;

	// @ts-ignore
	//Sentry
	//	.captureException(targetError);
}

function sendEvent(event) {
	// @ts-ignore
	//Sentry
	//	.captureEvent(event);
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

// ============================================
// BACKUP SYNC - Sync suspended tabs to external localStorage
// ============================================

let backupSyncFrame: HTMLIFrameElement | null = null;
let backupSyncReady = false;

function initBackupSync() {
	console.log('[BackupSync] Initializing...');
	console.log('[BackupSync] Expected origin:', BACKUP_SYNC_ORIGIN);

	backupSyncFrame = document.getElementById('backupSyncFrame') as HTMLIFrameElement;

	if (!backupSyncFrame) {
		console.error('[BackupSync] ERROR: iframe element not found in DOM');
		return;
	}

	console.log('[BackupSync] iframe element found:', backupSyncFrame);
	console.log('[BackupSync] iframe src:', backupSyncFrame.src);

	// Function to mark iframe as ready and start sync
	const markReady = () => {
		console.log('[BackupSync] iframe onload fired');
		// Give iframe 500ms to initialize its scripts
		setTimeout(() => {
			backupSyncReady = true;
			console.log('[BackupSync] iframe marked as ready, starting initial sync');
			syncSuspendedTabs();
		}, 500);
	};

	// Check if iframe is already loaded (if we attached listener after load event)
	// For cross-origin iframes we can't check contentDocument, so we just assume it's loaded
	// if we're attaching the listener after a delay
	const isAlreadyLoaded = backupSyncFrame.src && document.readyState === 'complete';

	if (isAlreadyLoaded) {
		console.log('[BackupSync] iframe appears to be already loaded, marking ready immediately');
		markReady();
	} else {
		// Wait for iframe to load
		// Note: postMessage from cross-origin iframe to parent doesn't work in offscreen documents
		backupSyncFrame.addEventListener('load', markReady);
		console.log('[BackupSync] Waiting for iframe load event...');
	}

	backupSyncFrame.addEventListener('error', (e) => {
		console.error('[BackupSync] iframe onerror:', e);
	});

	// Listen for acknowledgment messages from iframe
	window.addEventListener('message', (event) => {
		console.log('[BackupSync] Received message:', {
			origin: event.origin,
			data: event.data,
			expectedOrigin: BACKUP_SYNC_ORIGIN,
			originMatch: event.origin === BACKUP_SYNC_ORIGIN
		});

		if (event.origin !== BACKUP_SYNC_ORIGIN) {
			console.log('[BackupSync] Origin mismatch, ignoring message');
			return;
		}

		if (event.data?.type === 'SYNC_ACK') {
			console.log(`[BackupSync] Acknowledged: ${event.data.count} tabs saved`);
		}
	});

	// Start periodic sync (every 20 seconds, aligned with heartbeat)
	setInterval(syncSuspendedTabs, 20000);

	console.log('[BackupSync] Initialization complete');
}

async function syncSuspendedTabs() {
	if (!backupSyncFrame || !backupSyncReady) {
		console.log('Backup sync not ready, skipping...');
		return;
	}

	try {
		// Request suspended tabs list from background
		const response = await chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:getSuspendedTabs]'
		});

		if (response?.tabs && Array.isArray(response.tabs)) {
			// Send to iframe
			backupSyncFrame.contentWindow?.postMessage({
				type: 'SYNC_TABS',
				tabs: response.tabs,
				timestamp: Date.now()
			}, BACKUP_SYNC_ORIGIN);

			console.log(`Synced ${response.tabs.length} suspended tabs to backup`);
		}
	} catch (error) {
		console.error('Error syncing suspended tabs:', error);
	}
}