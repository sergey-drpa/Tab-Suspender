module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	setupFilesAfterEnv: [
		// External Libraries
		"<rootDir>/test/lib/Chrome.ts",
		// Load Global Variables...
		"<rootDir>/fancy-settings/source/lib/store.ts",
		"<rootDir>/modules/Settings.ts",
		"<rootDir>/modules/TabObserver.ts",
	],
};