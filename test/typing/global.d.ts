// @ts-ignore

declare global {
	// @ts-ignore
	class SettingsStore {};
	// @ts-ignore
	let TabObserver;
	// @ts-ignore
	let DEFAULT_SETTINGS;
	// @ts-ignore
	let debug;
	// @ts-ignore
	let pauseTics;
	// @ts-ignore
	let batteryLevel;

	let parkUrl: string;

	let TSSessionId: number;
	let previousTSSessionId: number;
	const TWO_WEEKS_MS;

	let getScreenCache;

	let database;

	let addModuleToGlobal;
}

export {};
