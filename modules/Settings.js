var NUMBER_TYPE = 'number';
var STRING_TYPE = 'string';


var SETTINGS_TYPES = {
	// Default: boolean
	// Numbers
	'timeout': NUMBER_TYPE,
	'limitOfOpenedTabs': NUMBER_TYPE,
	'closeTimeout': NUMBER_TYPE,
	'screenshotQuality': NUMBER_TYPE,
	'discardTimeoutFactor': NUMBER_TYPE,
	'battLvlLessValue': NUMBER_TYPE,
	// Strings
	'exceptionPatternsV2': STRING_TYPE,
	'parkBgColor': STRING_TYPE,
	'screenshotCssStyle': STRING_TYPE,
	'restoreButtonView': STRING_TYPE,
};

var DEFAULT_SETTINGS = {
	'active': true,
	'timeout': 30 * 60,
	'pinned': true,
	'isCloseTabsOn': false,
	'ignoreAudible': true,
	'limitOfOpenedTabs': 20,
	'closeTimeout': 60 * 60,
	'autoRestoreTab': false,
	'restoreOnMouseHover': true,
	'reloadTabOnRestore': false,
	'exceptionPatterns': null, // DEPRECATED
	'exceptionPatternsV2': '*mail.google.com*\n*outlook.live.com*\n*service.mail.com*\n*mail.yahoo.com*\n*mail.aol.com*\n*icloud.com/#mail*\nexamplesite.com*\n*.examplesitesecond.com*', // <<=== Continue There TODO - DONE
	// Tab Icon
	'tabIconOpacityChange': true,
	'animateTabIconSuspendTimeout': false,
	'tabIconStatusVisualize': false,
	'restoreTabOnStartup': false,
	'parkBgColor': 'FFFFFF',
	'autoSuspendOnlyOnBatteryOnly': false,
	'startDiscarted': true,
	'startNormalTabsDiscarted': false,
	'screenshotQuality': 80,
	'discardTabAfterSuspendWithTimeout': true,
	'discardTimeoutFactor': 0.05,
	'openUnfocusedTabDiscarded': false,
	'enableSuspendOnlyIfBattLvlLessValue': false,
	'battLvlLessValue': 50,
	'screenshotCssStyle': '',
	'adaptiveSuspendTimeout': true,
	'restoreButtonView': 'roundIcon', /* Available: roundIcon, noIcon, topBar */
	'sendErrors': true,
	'ignoreCloseGroupedTabs': true,
	'popup_showWindowSessionByDefault': false
};
