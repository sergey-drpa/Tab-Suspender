/**
 * Tracks when a service worker was last alive and extends the service worker
 * lifetime by writing the current time to extension storage every 20 seconds.
 * You should still prepare for unexpected termination - for example, if the
 * extension process crashes or your extension is manually stopped at
 * chrome://serviceworker-internals.
 */
let heartbeatInterval;

void startHeartbeat();

async function runHeartbeat() {
	await chrome.storage.local.set({ 'last-heartbeat': new Date().getTime() });
}

/**
 * Starts the heartbeat interval which keeps the service worker alive. Call
 * this sparingly when you are doing work which requires persistence, and call
 * stopHeartbeat once that work is complete.
 */
async function startHeartbeat() {
	// Run the heartbeat once at service worker startup.
	void runHeartbeat().then(() => {
		// Then again every 20 seconds.
		heartbeatInterval = setInterval(runHeartbeat, 20 * 1000);
	});
}

async function stopHeartbeat() {
	clearInterval(heartbeatInterval);
}

/**
 * Returns the last heartbeat stored in extension storage, or undefined if
 * the heartbeat has never run before.
 */
async function getLastHeartbeat() {
	return (await chrome.storage.local.get('last-heartbeat'))['last-heartbeat'];
}