module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	"roots": [
		"<rootDir>/test"
	],
	setupFilesAfterEnv: [
		// External Libraries
		"<rootDir>/test/lib/Chrome.ts",
		// Load Global Variables...
		"<rootDir>/fancy-settings/source/lib/store.ts",
		"<rootDir>/modules/Settings.ts",
		"<rootDir>/modules/TabObserver.ts",
	],
};