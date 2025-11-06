/**
 * DEPRECATED: This approach using setInterval does not reliably keep MV3 service workers alive.
 *
 * The new approach uses the offscreen document (offscreenDocument.ts) to send periodic
 * heartbeat messages to the service worker. Offscreen documents can run setInterval
 * reliably and message handling resets the service worker's idle timer.
 *
 * See offscreenDocument.ts:startServiceWorkerHeartbeat() for the active implementation.
 *
 * This code is kept for backward compatibility but may not be effective in MV3.
 */
let heartbeatInterval;

// Disabled - using offscreen document heartbeat instead
// void startHeartbeat();

async function runHeartbeat() {
	await chrome.storage.local.set({ 'last-heartbeat': new Date().getTime() });
}

/**
 * Starts the heartbeat interval which keeps the service worker alive. Call
 * this sparingly when you are doing work which requires persistence, and call
 * stopHeartbeat once that work is complete.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function startHeartbeat() {
	// Run the heartbeat once at service worker startup.
	void runHeartbeat().then(() => {
		// Then again every 20 seconds.
		heartbeatInterval = setInterval(runHeartbeat, 20 * 1000);
	});
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function stopHeartbeat() {
	clearInterval(heartbeatInterval);
}

/**
 * Returns the last heartbeat stored in extension storage, or undefined if
 * the heartbeat has never run before.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getLastHeartbeat() {
	return (await chrome.storage.local.get('last-heartbeat'))['last-heartbeat'];
}