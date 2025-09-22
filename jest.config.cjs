module.exports = {
	preset: 'ts-jest',
	testTimeout: 30000,
	testEnvironment: 'jsdom',
	"roots": [
		"<rootDir>/test"
	],
	setupFilesAfterEnv: [
		// External Libraries
		"<rootDir>/test/lib/Chrome.ts",
		"<rootDir>/test/typing/global.d.ts",
		// Load Global Variables...
		"<rootDir>/fancy-settings/source/lib/store.ts",
		"<rootDir>/modules/Settings.ts",
		"<rootDir>/modules/TabObserver.ts",
	],
};