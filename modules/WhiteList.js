/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 *
 */
// eslint-disable-next-line no-redeclare
function WhiteList(settings) {
	'use strict';

	this.persistKey = 'exceptionPatternsV2';
	this.settings = settings;

	let patternsString = settings.get('exceptionPatternsV2');
	if (patternsString != null) {
		let localExceptionPatterns = patternsString.split(/[,\s]/);
		if (localExceptionPatterns != null) {
			this.patternList = [];
			for (let i = 0; i < localExceptionPatterns.length; i++) {
				if (localExceptionPatterns[i] != null && localExceptionPatterns[i].length > 0) {
					let patternObject = this.createPatternObject(localExceptionPatterns[i]);
					if (patternObject != null)
						this.patternList.push(patternObject);
				}
			}
		}
	} else
		this.patternList = [];

	this.setupBackwardCompatibility();
}

/**
 *
 */
WhiteList.prototype.isURIException = function(url) {
	'use strict';

	let filterException = false;

	try {
		url = this.trimUrl(url);
		if (url == null)
			return false;

		if (this.findAffectdPatternIndexByUrl(url) != null)
			filterException = true;
	} catch (ex) {
		return false;
	}

	return filterException;
};

/**
 *
 */
WhiteList.prototype.createPatternObject = function(pattern) {
	'use strict';

	if (!this.isWrongPattern(pattern)) {
		let regExp = this.createRegExp(pattern);
		if (regExp != null)
			return { pattern: pattern, regExp: regExp };
	}
	if (debug == true)
		console.log('WhiteList: init Wrong pattern(skipped): ' + pattern);
	return null;
};

/**
 *
 */
WhiteList.prototype.addPattern = function(pattern) {
	'use strict';

	let patternObject;
	if (pattern != null && (patternObject = this.createPatternObject(pattern)) != null) {
		this.patternList.push(patternObject);
		this.persist();

		if (debug == true)
			console.log('WhiteList: added pattern ' + pattern);

		chrome.notifications.clear('userInfo');
		chrome.notifications.create('userInfo',
			{
				type: 'basic',
				iconUrl: 'img/icon16.png',
				title: 'Added to Whitelist',
				message: pattern,
				priority: 2,
			},
			function() {
				console.log('Last error:', chrome.runtime.lastError);
			}
		);
	} else if (debug == true)
		console.log('WhiteList: error added pattern: ' + pattern);
};

/**
 *
 */
WhiteList.prototype.isWrongPattern = function(pattern) {
	'use strict';

	if (pattern == '' || pattern == '*')
		return true;
	return false;
};

/**
 *
 */
WhiteList.prototype.removePatternsAffectUrl = function(url) {
	'use strict';

	url = this.trimUrl(url);
	if (url == null)
		return false;

	let affected = false;
	let i;
	let removedPatterns = [];
	while ((i = this.findAffectdPatternIndexByUrl(url)) != null) {
		affected = true;

		if (debug == true)
			console.log('WhiteList: Removed pattern ' + this.patternList[i].pattern);

		removedPatterns.push(this.patternList[i].pattern);
		this.patternList.splice(i, 1);
	}

	if (affected) {
		this.persist();

		chrome.notifications.create('userInfo',
			{
				type: 'basic',
				iconUrl: 'img/icon16.png',
				title: 'Removed from Whitelist',
				message: removedPatterns[0]
			}
		);
	}
};

/**
 *
 */
WhiteList.prototype.persist = function() {
	'use strict';

	let patterns = [];
	for (let i in this.patternList)
		patterns.push(this.patternList[i].pattern);

	this.settings.set(this.persistKey, patterns.join('\n'));
};

/**
 *
 */
WhiteList.prototype.trimUrl = function(url) {
	'use strict';

	/* Acceptable protocols: */
	if (url.substring(0, 7) == 'http://')
		return url.substring(7);
	else if (url.substring(0, 8) == 'https://')
		return url.substring(8);
	else
		return null;
};

/**
 *
 */
WhiteList.prototype.findAffectdPatternIndexByUrl = function(url) {
	'use strict';

	for (let i = 0; i < this.patternList.length; i++) {
		if (this.patternList[i] != null) {
			try {
				let result = this.patternList[i].regExp.exec(url);

				if (result != null)
					return i;
			} catch (e) {
				if (debug)
					console.error(e);
			}
		}
	}

	return null;
};

/**
 *
 */
WhiteList.prototype.setupBackwardCompatibility = function() {
	'use strict';

	// Load and prepare Very Old exclusion list

	let oldPatternsString = this.settings.get('exceptionPatterns');
	let oldPatternsStringConvertedToV2 = '';
	if (oldPatternsString != null && oldPatternsString != '') {
		let oldExceptionPatterns = oldPatternsString.split(/[,\s]/);
		if (oldExceptionPatterns != null) {
			for (let i = 0; i < oldExceptionPatterns.length; i++) {
				if (oldExceptionPatterns[i] != '') {
					oldExceptionPatterns[i] = oldExceptionPatterns[i].replace(/^/, '*');
					oldExceptionPatterns[i] = oldExceptionPatterns[i].replace(/$/, '*');
					oldPatternsStringConvertedToV2 += oldExceptionPatterns[i] + '\n';
					let patternObject = this.createPatternObject(oldExceptionPatterns[i]);
					if (patternObject != null)
						this.patternList.push(patternObject);

				}
			}
		}
		this.settings.set('exceptionPatterns', null);
	}


	if (oldPatternsStringConvertedToV2 != null && oldPatternsStringConvertedToV2 != '') {
		this.persist();
	}
};

/**
 *
 */
WhiteList.prototype.createRegExp = function(pattern) {
	'use strict';

	try {
		pattern = pattern.replace(/\./g, '\\.');
		pattern = pattern.replace(/\*/g, '.*');
		pattern = '^' + pattern + '$';
		return new RegExp(pattern, 'i');
	} catch (e) {
		console.error(e);
		return null;
	}
};
