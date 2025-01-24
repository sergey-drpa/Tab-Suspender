'use strict';

// eslint-disable-next-line no-redeclare
const debug = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const trace = true;

/* Definitions for Syntax Check */
// eslint-disable-next-line no-redeclare
//var chrome = window.chrome = window.chrome || {};
// eslint-disable-next-line no-redeclare
//var trackError = undefined;

/**
 *
 */

if(typeof window !== "undefined") {
	// @ts-ignore
	trackError = window.trackError = window.trackError || {}

	// @ts-ignore
	window.nativeConsole = window.console;
	// @ts-ignore
	window.console = {
		// @ts-ignore
		warn: window.nativeConsole.warn,
		// @ts-ignore
		assert: window.nativeConsole.assert,
		// @ts-ignore
		clear: window.nativeConsole.clear,
		// @ts-ignore
		count: window.nativeConsole.count,
		// @ts-ignore
		debug: window.nativeConsole.debug,
		// @ts-ignore
		dir: window.nativeConsole.dir,
		// @ts-ignore
		dirxml: window.nativeConsole.dirxml,
		// @ts-ignore
		error: window.nativeConsole.error,
		// @ts-ignore
		exception: window.nativeConsole.exception,
		// @ts-ignore
		group: window.nativeConsole.group,
		// @ts-ignore
		groupCollapsed: window.nativeConsole.groupCollapsed,
		// @ts-ignore
		groupEnd: window.nativeConsole.groupEnd,
		// @ts-ignore
		info: window.nativeConsole.info,
		// @ts-ignore
		msIsIndependentlyComposed: window.nativeConsole.msIsIndependentlyComposed,
		// @ts-ignore
		profile: window.nativeConsole.profile,
		// @ts-ignore
		profileEnd: window.nativeConsole.profileEnd,
		// @ts-ignore
		select: window.nativeConsole.select,
		// @ts-ignore
		table: window.nativeConsole.table,
		// @ts-ignore
		time: window.nativeConsole.time,
		// @ts-ignore
		timeEnd: window.nativeConsole.timeEnd,
		// @ts-ignore
		trace: window.nativeConsole.trace
	};
}

	// @ts-ignore
const consoleLog = typeof window !== "undefined" ? window.nativeConsole.log : console.log;
/*if(typeof window !== "undefined") {
	window.consoleLog = window.nativeConsole;
}*/
console.log = function(...args) {
	let trace;
	if (debug)
		try {
			let a = {};
			// @ts-ignore
			a.debug();
		} catch (ex) {
			trace = ex.stack;
		}

	let nativeConsoleLog = consoleLog;
	if(typeof window !== "undefined") {
		// @ts-ignore
		nativeConsoleLog = window.nativeConsole.log;
	}
	nativeConsoleLog(...args, (debug ? { trace: trace } : ''));
};

/**
 *
 */
const consoleError = console.error
console.error = function(message, exception) {
	if (debug)
		chrome.notifications.create(
			{
				type: 'list',
				requireInteraction: true,
				iconUrl: 'img/icon16.png',
				title: 'New Exception',
				message: '' + message,
				items: [
					{ title: '', message: '' + message },
					{
						title: '',
						message: (exception && exception instanceof Error && exception.stack != null ? exception.stack : '' + exception + '\n' + new Error().stack)
					}
				]
			}
		);

	//window.nativeConsole.error(arguments);
	consoleError.apply(this, arguments);

	if (trackError)
		try {
			let error;
			for (let i = 0; i < arguments.length; i++) {
				if (arguments[i] != null && arguments[i] instanceof Error) {
					if (error == null)
						error = arguments[i];
					else
						error.message += ' ->NestedException-> ' + arguments[i].message;
				}
			}

			if (error == null)
				error = new Error('');

			for (let j = 0; j < arguments.length; j++) {
				if (arguments[j] != null && typeof arguments[j] === 'string')
					error.message += ' | ' + arguments[j];
				else if (arguments[j] != null && typeof arguments[j] === 'object' && !(arguments[j] instanceof Error))
					error.message += ' | ' + JSON.stringify(arguments[j]);
			}

			if (error.message === '')
				error.message = 'Really no arguments provided!';

			trackError(error);
		} catch (e) {
			consoleError('Error while logging Error)) ', e);
		}
};

const expectedErrorsRegexpCache: {[key: string]: RegExp} = {};

const globalIgnoredErrors = [
	'The browser is shutting down.',
	'RegExp:No tab with id: \\d*\\.',
	'RegExp:Cannot discard tab with id: \\d{1,5}\\.',
];

function checkOccurrenceOfExpectedErrors(errorMessage: string, expectedList: any[]) {
	let expectedMessage = false;
	for (let j = 0; j < expectedList.length; j++) {
		if (expectedList[j].indexOf('RegExp:') === 0) { // REGEXP
			const regExpString = expectedList[j].substr(7);
			let cachedRegExp = expectedErrorsRegexpCache[regExpString];
			if (cachedRegExp == null) {
				cachedRegExp = expectedErrorsRegexpCache[regExpString] = RegExp(regExpString);
			}
			if (cachedRegExp.test(errorMessage))
				expectedMessage = true;
		} else if (errorMessage === expectedList[j])
			expectedMessage = true;
	}
	return expectedMessage;
}

// eslint-disable-next-line no-redeclare,no-unused-vars,@typescript-eslint/no-unused-vars
function hasLastError(expectedMessage?: string | string[], error?: Error, comment?: string) {
	let expectedList = [];

	if (expectedMessage != null) {
		if (Array.isArray(expectedMessage))
			expectedList = expectedList.concat(expectedMessage);
		else
			expectedList.push(expectedMessage);
	}

	expectedList = expectedList.concat(globalIgnoredErrors);

	let expected: boolean;

	if (error != null) {
		expected = checkOccurrenceOfExpectedErrors(error.message, expectedList);

		if (expected) {
			if (comment)
				console.warn(comment, error);
			else
				console.warn(error);
			//return true;
		}
		else {
			if (comment)
				console.error(comment, error);
			else
				console.error(error);
		}
	}

	if (chrome.runtime.lastError) {
		expected = checkOccurrenceOfExpectedErrors(chrome.runtime.lastError.message, expectedList);

		if (expected) {
			if (comment)
				console.warn(`${comment}: ${chrome.runtime.lastError}`);
			else
				console.warn(chrome.runtime.lastError);
			//return true;
		}
		else {
			if (comment)
				console.error(`${comment}: ${chrome.runtime.lastError}`);
			else
				console.error(chrome.runtime.lastError);
		}
	}

	return false;
}

/**
 *
 */
// eslint-disable-next-line no-redeclare,no-unused-vars
function versionCompare(v1, v2, options?) {
	'use strict';

	let lexicographical = options && options.lexicographical,
		zeroExtend = options && options.zeroExtend,
		v1parts = v1.split('.'),
		v2parts = v2.split('.');

	function isValidPart(x) {
		return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
	}

	if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
		return NaN;
	}

	if (zeroExtend) {
		while (v1parts.length < v2parts.length) v1parts.push('0');
		while (v2parts.length < v1parts.length) v2parts.push('0');
	}

	if (!lexicographical) {
		v1parts = v1parts.map(Number);
		v2parts = v2parts.map(Number);
	}

	for (let i = 0; i < v1parts.length; ++i) {
		if (v2parts.length == i) {
			return 1;
		}

		if (v1parts[i] == v2parts[i]) {
			continue;
		} else if (v1parts[i] > v2parts[i]) {
			return 1;
		} else {
			return -1;
		}
	}

	if (v1parts.length != v2parts.length) {
		return -1;
	}

	return 0;
}

/**
 *
 */
// eslint-disable-next-line no-redeclare,no-unused-vars
/*function parseUrlParam(url, val) {
	'use strict';

	let tmp = [];
	// eslint-disable-next-line no-useless-escape
	const parts = url.substr(1).split(/[&\?]/);

	for (let i = 0; i < parts.length; i++) {
		tmp = parts[i].split('=');
		if (tmp[0] === val)
			return decodeURIComponent(tmp[1]);
	}

	return null;
}*/
function parseUrlParam(url, parameterName) {
	try {
		if (url == null || url === '')
			return null;
		return new URL(url).searchParams.get(parameterName);
	} catch (e) {
		console.error(`Error while parsing URL[${parameterName}] parameterName[${parameterName}]`, e);
		return null;
	}
}

/**
 *
 */
// eslint-disable-next-line no-unused-vars,no-redeclare
function sql_error(arg, arg2, arg3) {
	'use strict';

	console.error('SQL error: ' + arg + arg2 + arg3, arg2);
}

// eslint-disable-next-line no-redeclare,no-unused-vars,@typescript-eslint/no-unused-vars
function extractHostname(url) {
	let hostname;
	//find & remove protocol (http, ftp, etc.) and get hostname

	if (url.indexOf('://') > -1) {
		hostname = url.split('/')[2];
	} else {
		hostname = url.split('/')[0];
	}

	//find & remove port number
	hostname = hostname.split(':')[0];
	//find & remove "?"
	hostname = hostname.split('?')[0];

	return hostname;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isDarkMode() {
	const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

	if(isDarkMode)
		console.log('Currently in dark mode');
	else
		console.log('Currently not in dark mode');

	return isDarkMode;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


if (typeof module != 'undefined')
	module.exports = {
		parseUrlParam,
		sleep,
	};