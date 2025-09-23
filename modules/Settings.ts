const NUMBER_TYPE = 'number';
const STRING_TYPE = 'string';
const BOOLEAN_TYPE = 'boolean';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SETTINGS_TYPES = {
	// Default: boolean
	// Numbers
	timeout: NUMBER_TYPE,
	limitOfOpenedTabs: NUMBER_TYPE,
	closeTimeout: NUMBER_TYPE,
	screenshotQuality: NUMBER_TYPE,
	discardTimeoutFactor: NUMBER_TYPE,
	battLvlLessValue: NUMBER_TYPE,
	// Strings
	exceptionPatternsV2: STRING_TYPE,
	parkBgColor: STRING_TYPE,
	screenshotCssStyle: STRING_TYPE,
	restoreButtonView: STRING_TYPE,
};

function GET_SETTINGS_TYPE(key: string): string {
	const foundType = SETTINGS_TYPES[key];
	if (foundType != null)
		return foundType;
	else
		return BOOLEAN_TYPE;
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars
class Settings {
	active: boolean;
	timeout: number;
	pinned: boolean;
	isCloseTabsOn: boolean;
	ignoreAudible: boolean;
	limitOfOpenedTabs: number;
	closeTimeout: number;
	autoRestoreTab: boolean;
	restoreOnMouseHover: boolean;
	reloadTabOnRestore: boolean;
	exceptionPatterns: null;
	exceptionPatternsV2: string;
	tabIconOpacityChange: boolean;
	animateTabIconSuspendTimeout: boolean;
	tabIconStatusVisualize: boolean;
	restoreTabOnStartup: boolean;
	parkBgColor: string;
	autoSuspendOnlyOnBatteryOnly: boolean;
	startDiscarted: boolean;
	startNormalTabsDiscarted: boolean;
	screenshotQuality: number;
	discardTabAfterSuspendWithTimeout: boolean;
	discardTimeoutFactor: number;
	openUnfocusedTabDiscarded: boolean;
	enableSuspendOnlyIfBattLvlLessValue: boolean;
	battLvlLessValue: number;
	screenshotCssStyle: string;
	adaptiveSuspendTimeout: boolean;
	restoreButtonView: string;
	sendErrors: boolean;
	ignoreCloseGroupedTabs: boolean;
	ignoreSuspendGroupedTabs: boolean;
	screenshotsEnabled: boolean;
	popup_showWindowSessionByDefault: boolean;
	// v2.0.0
	localStorageMigrated: boolean;
	localStorageFormDataCleaned: boolean;
}

//type ISettingsFields = { [Property in keyof ISettings]?: boolean };
//import { keys } from 'ts-transformer-keys';
//console.trace(`ISettingsFields: `, keys<ISettings>());

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEFAULT_SETTINGS: Settings = {
	active: true,
	timeout: 30 * 60,
	pinned: true,
	isCloseTabsOn: false,
	ignoreAudible: true,
	limitOfOpenedTabs: 20,
	closeTimeout: 60 * 60,
	autoRestoreTab: false,
	restoreOnMouseHover: true,
	reloadTabOnRestore: false,
	exceptionPatterns: null, // DEPRECATED
	exceptionPatternsV2: '*mail.google.com*\n*outlook.live.com*\n*service.mail.com*\n*mail.yahoo.com*\n*mail.aol.com*\n*icloud.com/#mail*\nexamplesite.com*\n*.examplesitesecond.com*', // <<=== Continue There TODO - DONE
	// Tab Icon
	tabIconOpacityChange: true,
	animateTabIconSuspendTimeout: false,
	tabIconStatusVisualize: false,
	restoreTabOnStartup: false,
	parkBgColor: 'FFFFFF',
	autoSuspendOnlyOnBatteryOnly: false,
	startDiscarted: true,
	startNormalTabsDiscarted: false,
	screenshotQuality: 80,
	discardTabAfterSuspendWithTimeout: true,
	discardTimeoutFactor: 0.05,
	openUnfocusedTabDiscarded: false,
	enableSuspendOnlyIfBattLvlLessValue: false,
	battLvlLessValue: 50,
	screenshotCssStyle: '',
	adaptiveSuspendTimeout: true,
	restoreButtonView: 'roundIcon', /* Available: roundIcon, noIcon, topBar */
	sendErrors: true,
	ignoreCloseGroupedTabs: true,
	ignoreSuspendGroupedTabs: false,
	screenshotsEnabled: true,
	popup_showWindowSessionByDefault: false,
	// v2.0.0
	localStorageMigrated: null,
	localStorageFormDataCleaned: null,
};

// @ts-ignore
if (typeof global !== "undefined") global.DEFAULT_SETTINGS = DEFAULT_SETTINGS;