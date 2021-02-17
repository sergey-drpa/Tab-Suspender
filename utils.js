'use strict';
// eslint-disable-next-line no-redeclare
let debug = false;

/* Definitions for Syntax Check */
// eslint-disable-next-line no-redeclare
var chrome = window.chrome = window.chrome || {};
// eslint-disable-next-line no-redeclare
var trackError = window.trackError = window.trackError || {};

/**
 *
 */
window.nativeConsole = window.console;
window.console = {
	warn: window.nativeConsole.warn,
	assert: window.nativeConsole.assert,
	clear: window.nativeConsole.clear,
	count: window.nativeConsole.count,
	debug: window.nativeConsole.debug,
	dir: window.nativeConsole.dir,
	dirxml: window.nativeConsole.dirxml,
	error: window.nativeConsole.error,
	exception: window.nativeConsole.exception,
	group: window.nativeConsole.group,
	groupCollapsed: window.nativeConsole.groupCollapsed,
	groupEnd: window.nativeConsole.groupEnd,
	info: window.nativeConsole.info,
	msIsIndependentlyComposed: window.nativeConsole.msIsIndependentlyComposed,
	profile: window.nativeConsole.profile,
	profileEnd: window.nativeConsole.profileEnd,
	select: window.nativeConsole.select,
	table: window.nativeConsole.table,
	time: window.nativeConsole.time,
	timeEnd: window.nativeConsole.timeEnd,
	trace: window.nativeConsole.trace
};
console.log = function(message, message2, message3) {
	let trace;
	if (debug)
		try {
			let a = {};
			a.debug();
		} catch (ex) {
			trace = ex.stack;
		}

	window.nativeConsole.log(message, message2, message3, (debug ? { trace: trace } : ''));
};

/**
 *
 */
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
	window.nativeConsole.error.apply(this, arguments);

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
			window.nativeConsole.error('Error while logging Error)) ', e);
		}
};

let globalIgnoredErrors = ['The browser is shutting down.',
	'RegExp:No tab with id: \\d{1,5}\\.',
	'RegExp:Cannot discard tab with id: \\d{1,5}\\.'];

// eslint-disable-next-line no-redeclare,no-unused-vars
function hasLastError(expectedMassage) {
	if (chrome.runtime.lastError) {
		let expectedList = [];
		if (expectedMassage != null && Array.isArray(expectedMassage))
			expectedList = expectedList.concat(expectedMassage);
		else
			for (let i = 0; i < arguments.length; i++)
				expectedList.push(arguments[i]);

		expectedList = expectedList.concat(globalIgnoredErrors);

		let expectedMessage = false;
		for (let j = 0; j < expectedList.length; j++) {
			if (expectedList[j].indexOf('RegExp:') === 0) { // REGEXP
				if (RegExp(expectedList[j].substr(7)).test(chrome.runtime.lastError.message))
					expectedMessage = true;
			} else if (chrome.runtime.lastError.message === expectedList[j])
				expectedMessage = true;
		}

		if (expectedMessage)
			console.warn(chrome.runtime.lastError);
		else
			console.error(chrome.runtime.lastError);
		return true;
	}
	return false;
}

/**
 *
 */
// eslint-disable-next-line no-redeclare,no-unused-vars
function versionCompare(v1, v2, options) {
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
function parseUrlParam(url, val) {
	'use strict';

	let tmp = [];
	// eslint-disable-next-line no-useless-escape
	let parts = url.substr(1).split(/[&\?]/);

	for (let i = 0; i < parts.length; i++) {
		tmp = parts[i].split('=');
		if (tmp[0] === val)
			return decodeURIComponent(tmp[1]);
	}

	return null;
}

/**
 *
 */
// eslint-disable-next-line no-unused-vars,no-redeclare
function sql_error(arg, arg2, arg3) {
	'use strict';

	console.error('SQL error: ' + arg + arg2 + arg3, arg2);
}

// eslint-disable-next-line no-redeclare,no-unused-vars
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
