/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

interface WhiteListPattern {
	pattern: string;
	regExp: RegExp;
}

/**
 *
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class WhiteList {

	private readonly persistKey: string;
	private settings: SettingsStore;
	private patternList: WhiteListPattern[];

	constructor(settings: SettingsStore) {
		this.persistKey = 'exceptionPatternsV2';
		this.settings = settings;

		settings.get('exceptionPatternsV2')
			.then(patternsString => {
				if (patternsString != null) {
					const localExceptionPatterns = patternsString.split(/[,\s]/);
					if (localExceptionPatterns != null) {
						this.patternList = [];
						for (let i = 0; i < localExceptionPatterns.length; i++) {
							if (localExceptionPatterns[i] != null && localExceptionPatterns[i].length > 0) {
								const patternObject = this.createPatternObject(localExceptionPatterns[i]);
								if (patternObject != null)
									this.patternList.push(patternObject);
							}
						}
					}
				} else
					this.patternList = [];
			})
			.catch(console.error);
	}

	removeUrlFromWhitelist(url) {
		if (url != null) {
			this.removePatternsAffectUrl(url);
			SettingsPageController.reloadSettings().then(()=>{
				setTimeout(function() {
					new BrowserActionControl(settings, whiteList, ContextMenuController.menuIdMap, pauseTics).synchronizeActiveTabs();
				}, 500);
			}).catch(console.error);
		}
	}

	/**
	 *
	 */
	isURIException(url) : boolean {

		let filterException = false;

		try {
			if (url == null)
				return false;

			url = this.trimUrl(url);

			if (this.findAffectdPatternIndexByUrl(url) != null)
				filterException = true;
		} catch (ex) {
			console.warn(`isURIException() error`, ex);
			return false;
		}

		return filterException;
	}

	/**
	 *
	 */
	createPatternObject(pattern: string) : WhiteListPattern | null {
		'use strict';

		if (!this.isWrongPattern(pattern)) {
			const regExp = this.createRegExp(pattern);
			if (regExp != null)
				return <WhiteListPattern>{ pattern: pattern, regExp: regExp };
		}
		if (debug == true)
			console.log('WhiteList: init Wrong pattern(skipped): ' + pattern);
		return null;
	}

	/**
	 *
	 */
	addPattern(pattern) {

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
					priority: 2
				},
				function() {
					console.log('Last error:', chrome.runtime.lastError);
				}
			);
		} else if (debug == true)
			console.log('WhiteList: error added pattern: ' + pattern);
	}

	/**
	 *
	 */
	isWrongPattern(pattern) : boolean {
		return pattern == '' || pattern == '*';
	}

	/**
	 *
	 */
	removePatternsAffectUrl(url) : boolean {

		url = this.trimUrl(url);
		if (url == null)
			return false;

		let affected = false;
		let i;
		const removedPatterns = [];
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
	}

	/**
	 *
	 */
	persist() {

		const patterns = [];
		for (let i in this.patternList)
			patterns.push(this.patternList[i].pattern);

		this.settings.set(this.persistKey, patterns.join('\n'));
	}

	/**
	 *
	 */
	trimUrl(url) : string | null {

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
	findAffectdPatternIndexByUrl(url) : number | null {

		for (let i = 0; i < this.patternList.length; i++) {
			if (this.patternList[i] != null) {
				try {
					const result = this.patternList[i].regExp.exec(url);

					if (result != null)
						return i;
				} catch (e) {
					if (debug)
						console.error(e);
				}
			}
		}

		return null;
	}

	/**
	 *
	 */
	createRegExp(pattern) : RegExp | null {

		try {
			pattern = pattern.replace(/\./g, '\\.');
			pattern = pattern.replace(/\*/g, '.*');
			pattern = '^' + pattern + '$';
			return new RegExp(pattern, 'i');
		} catch (e) {
			console.error(e);
			return null;
		}
	}

	/*** Messaging **/
	hideWhiteListDialog(tabId, options?) {
		chrome.tabs.sendMessage(tabId, { method: '[AutomaticTabCleaner:hideDialogRequetToTab]', options: options }).catch(console.error);
	}
}
