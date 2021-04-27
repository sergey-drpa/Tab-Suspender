/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
'use strict';


// eslint-disable-next-line no-redeclare
var chrome = window.chrome || {};
var drawAddPageToWhiteListDialog = window.drawAddPageToWhiteListDialog || {};
// eslint-disable-next-line no-redeclare
let debug = false;
let debugPerformance = false;

if (debugPerformance) {
	console.log('Compiled inside: ', Date.now());
	console.time('Load time...');
}

let urlParamChache = {};
let backProcessed = false;
let title;
let favicon;
let link;
let secondTime = false;
let restoreEvent = 'hover';
let reloadTabOnRestore = false;
let tabIconOpacityChange = false;
let tabIconStatusVisualize = false;
let tabId;
let targetUrl;
let bgScreen = null; /* TEMPORARLY VARDON'T FORGGOT TO CLEAN AFTER DRAW! */
let screenshotDevicePixelRatio;
let isTabMarkedForUnsuspend = false;
let parkedUrl;

let loaded = new Promise(function(resolve) {
	window.addEventListener('load', function() {
		if (debugPerformance)
			console.log('onload: ', Date.now());

		resolve();
	});
});

let DOMContentLoaded;
window.domLoadedPromise = new Promise(function(resolve) {
	document.addEventListener('DOMContentLoaded', function() {
		if(DOMContentLoaded) return;
		DOMContentLoaded = true;

		if (debugPerformance)
			console.log('onDOMContentLoaded: ', Date.now());

		try {
			createTitleAndIcon();
			applysUserDisplayHeight(window.innerHeight);
			// eslint-disable-next-line no-empty
		} catch (e) {
		}

		resolve();
	}, true);
});

if (debugPerformance)
	console.log('getBackgroundPage: ', Date.now());

try {
	chrome.runtime.getBackgroundPage(function(bgpage) {
		if (debugPerformance)
			console.log('getBackgroundPage Loaded: ', Date.now());

		window.domLoadedPromise.then(function() {

			try {
				let isStartDiscarted = bgpage.getStartDiscarted();

				console.log('bgpage.getStartDiscarted(): ', isStartDiscarted);

				tabId = parseUrlParam('tabId');

				if (isStartDiscarted == true) {
					if ((Date.now() - bgpage.getStartedAt()) < 15000) {
						console.log('(new Date().getTime() - bgpage.getStartedAt()) < 15000: ', (Date.now() - bgpage.getStartedAt()) < 15000);
						if (bgpage.isFirstTimeTabDiscard(tabId)) {
							console.log('bgpage.isFirstTimeTabDiscard(tabId): ', bgpage.isFirstTimeTabDiscard(tabId));
							chrome.tabs.getCurrent(function(tab) {
								if (tab.active === false) {
									console.log('tab.active: ', tab.active);
									window.stop();
									chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:DiscardTab]' });
									return;
								} else
									continueCheck();
							});
						} else
							continueCheck();
					} else
						continueCheck();
				} else
					continueCheck();
			} catch (e) {
				console.error(e);

				applyRestoreButtonView();
				setTimeout(drawContent, 0);
				setTimeout(continueStart, 0);
			}

			/* CHECK IF TAB MARKED FOR UNSUSPEND */
			function continueCheck() {
				if (debugPerformance)
					console.log('Continue Chaeck: ', Date.now());

				chrome.tabs.getCurrent(function(tab) {
					parkedUrl = bgpage.getTabInfo(tab).parkedUrl;
				});

				isTabMarkedForUnsuspend = bgpage.isTabMarkedForUnsuspend(tabId, parseUrlParam('sessionId'), { 'remove': true });
				if (debug)
					console.log('isTabMarkedForUnsuspend: ', isTabMarkedForUnsuspend);

				if (isTabMarkedForUnsuspend) {
					document.getElementById('resoteImg').style.display = 'none';
					document.getElementById('topRestore').style.display = 'none';
					reloadTabOnRestore = bgpage.getReloadTabOnRestore();
					setTimeout(continueStart, 0);
				} else {
					if (debugPerformance)
						console.log('Get Screen: ', Date.now());

					tabIconStatusVisualize = bgpage.getTabIconStatusVisualize();
					tabIconOpacityChange = bgpage.getTabIconOpacityChange();

					bgpage.getScreen(tabId, parseUrlParam('sessionId'), function(scr, pixRat) {
						try {
							if (debugPerformance)
								console.log('Get Screen Loaded: ', Date.now());

							bgScreen = scr;
							if (!pixRat) {
								screenshotDevicePixelRatio = window.devicePixelRatio;
							} else {
								screenshotDevicePixelRatio = pixRat;
							}
							/* EXPERIMANTAL */
							setTimeout(drawContent, 0);
							setTimeout(continueStart, 0);
						} catch (e) {
							console.error(e);

							applyRestoreButtonView();
							setTimeout(drawContent, 0);
							setTimeout(continueStart, 0);
						}
					});

					if (debugPerformance)
						console.log('Apply background: ', Date.now());

					applysSreenshotCssStyle(bgpage.getScreenshotCssStyle());
					applyBackground('#' + bgpage.getParkBgColor());
					applyRestoreButtonView(bgpage.getRestoreButtonView());
					restoreEvent = bgpage.getRestoreEvent();
					reloadTabOnRestore = bgpage.getReloadTabOnRestore();

					createTitleAndIcon(true);
				}
			}
		});

		window.domLoadedPromise = null;
	});
} catch (e) {
	console.error(e);

	window.domLoadedPromise.then(function() {
		applyRestoreButtonView();
		setTimeout(drawContent, 0);
		setTimeout(continueStart, 0);
	});
}

function applysUserDisplayHeight(height) {
	let resoteImg = document.getElementById('resoteImg');

	console.log('DisplayHeight: ', height);
	if (height != null) {
		if (height <= 600) {
			resoteImg.width = '128';
			resoteImg.height = '128';
			resoteImg.classList.add('h600');
		} else if (height <= 800) {
			resoteImg.width = '160';
			resoteImg.height = '160';
			resoteImg.classList.add('h800');
		} else if (height <= 1024) {
			resoteImg.width = '196';
			resoteImg.height = '196';
			resoteImg.classList.add('h1024');
		}
	}

	resoteImg.classList.remove('wait-for-render');
}

function applyRestoreButtonView(restoreButtonView) {
	let screen = document.getElementById('screen');
	let resroreImg = document.getElementById('resoteImg');

	let initOriginalUrlBlock = function() {
		/* Native Url Block */
		document.body.classList.add('always-visible');
		document.getElementById('nativeUrlSpan').onclick = document.getElementById('nativeUrl').onclick = function() {
			window.getSelection().selectAllChildren(document.getElementById('nativeUrlSpan'));
		};
	};

	if (restoreButtonView == null || restoreButtonView == 'roundIcon') {
		resroreImg.style.display = 'block';
		document.getElementById('topRestore').style.display = 'none';

		initOriginalUrlBlock();

		resroreImg.onmouseover = function() {
			if (restoreEvent == 'hover') {
				goBack();
				resroreImg.className = 'restore inprogress';
				screen.classList.add('inprogress');
			}
		};

		resroreImg.onclick = function() {
			if (restoreEvent == 'click') {
				goBack();
				resroreImg.className = 'restore inprogress';
				screen.classList.add('inprogress');
			}
		};
	} else if (restoreButtonView == 'topBar') {
		resroreImg.style.display = 'none';
		document.getElementById('topRestore').style.display = 'block';

		document.getElementById('topRestore').onclick = function() {
			goBack();
			document.getElementById('topRestore').className = 'topRestore inprogress';
			screen.classList.add('inprogress');
		};
	} else if (restoreButtonView == 'noIcon') {
		resroreImg.style.display = 'none';
		document.getElementById('topRestore').style.display = 'none';

		initOriginalUrlBlock();
	}

	document.getElementById('screenDiv').onclick = function() {
		goBack();
		resroreImg.className = 'restore inprogress';
		screen.classList.add('inprogress');
	};
}

function applyBackground(color) {
	document.body.style.background = color;
}

function applysSreenshotCssStyle(cssText) {
	document.getElementById('screen').style.cssText = cssText;
	applyPixelRatio();
}

function createTitleAndIcon(force) {
	console.log('createTitleAndIcon...');

	if (title == null)
		title = parseUrlParam('title');
	if (document.title !== title)
		document.title = title;

	link = document.getElementById('faviconLink');

	if (link != null && !force)
		if (link.href != null && link.href.indexOf('img/icon16_off.png') == -1)
			return;

	if (link == null) {
		link = document.createElement('link');
		link.type = 'image/x-icon';
		link.rel = 'shortcut icon';
	}

	if (favicon == null || force) {
		generateFaviconUri(parseUrlParam('icon', false), function(proccesedIcon) {
			favicon = proccesedIcon;
			link.href = proccesedIcon;
			if (link.id !== 'faviconLink') {
				link.id = 'faviconLink';
				document.getElementsByTagName('head')[0].appendChild(link);
			}
		});
	} else {
		if (favicon != null)
			link.href = favicon;
	}
}

// eslint-disable-next-line no-redeclare
function parseUrlParam(name, doNotCache) {
	let val;
	if ((val = urlParamChache[name]) != null)
		return val;

	let tmp = [];
	let parts = window.location.search.substr(1).split('&');

	for (let i = 0; i < parts.length; i++) {
		tmp = parts[i].split('=');
		if (tmp[0] === name) {
			if (doNotCache === true)
				return decodeURIComponent(tmp[1]);
			else
				return urlParamChache[name] = decodeURIComponent(tmp[1]);
		}
	}
}

function generateFaviconUri(url, callback) {
	console.log('generateFaviconUri...');
	let img = new Image();
	let onCorruptedUrlTimeout = setTimeout(()=>{img.onerror();}, 3000);
	img.onload = function() {
		clearTimeout(onCorruptedUrlTimeout);
		let canvas, ctx;
		canvas = window.document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		ctx = canvas.getContext('2d');
		if(tabIconOpacityChange){
			ctx.globalAlpha = 0.65;
		} else {
			ctx.globalAlpha = 1;
		}
		ctx.drawImage(img, 0, 0);
		console.log('tabIconStatusVisualize: ' + tabIconStatusVisualize);
		if (tabIconStatusVisualize) {
			drawWaterMark(canvas, ctx, img.width, callback);
		} else {
			callback(canvas.toDataURL());
		}
	};
	img.onerror = (e) => {
		clearTimeout(onCorruptedUrlTimeout);
		console.log('Loading Favicon Error');
		img.src = chrome.extension.getURL('img/new_page.png');
	};
	img.src = url && url != 'undefined' ? url : chrome.extension.getURL('img/new_page.png');

}

function drawWaterMark(canvas, ctx, width, callback) {
	console.log('drawWaterMark...');
	let img = new Image();
	if (width !== 64) {
		console.error('Unexpected: Favicon image != 64x64 -> ' + width);
		callback(canvas.toDataURL());
		return;
	}
	img.onload = function() {
		ctx.globalAlpha = 0.95;

		ctx.drawImage(img, 49, 49);
		callback(canvas.toDataURL());
	};
	img.src = 'img/watermark/Circle_Blue_16_Brite_100.png';
}

function cssScale() {
	return 'scale(' + 1 / screenshotDevicePixelRatio + ', ' + 1 / screenshotDevicePixelRatio + ')';
}

function applyPixelRatio() {
	let screenImg = document.getElementById('screen');

	try {
		console.log('screenshotDevicePixelRatio: ', screenshotDevicePixelRatio);
		if (screenshotDevicePixelRatio > 1)
			screenImg.style.transform = cssScale();
	} catch (e) {
		console.error(e);
	}
}

function drawContent() {
	if (debugPerformance)
		console.log('Drow Content: ', Date.now());
	//createTitleAndIcon();
	let screenImg = document.getElementById('screen');

	applyPixelRatio();

	if (bgScreen == null) {
		screenImg.style.display = 'none';
		document.getElementById('title').innerHTML = title;
		document.getElementById('title').href = parseUrlParam('url');
		document.getElementById('favicon').src = favicon;
		document.getElementById('title_div').style.display = 'block';
		document.getElementById('nativeUrl').classList.add('visible');
	} else
		screenImg.src = bgScreen;

	/* TODO: add dynamic restoreImg resize */

	bgScreen = null;
	favicon = null;

	if (debugPerformance) {
		console.log('Complete!!!: ', Date.now());
		console.timeEnd('Load time...');
	}
}

function continueStart() {
	if (isTabMarkedForUnsuspend) {
		if (debug)
			console.log('Prepare to go Back!');

		goBack({ force: true });

		return;
	}

	/****
	 * TODO: Looks like document.readyState === "complete" != window.addEventListener('load'
	 */
	console.log('Waiting for Page load...', Date.now());
	loaded.then(()=>{
		console.log('Page Already loaded');
		startEX();
	});
}

function startEX() {
	if (debugPerformance)
		console.log('Start begun...!', Date.now());
	favicon = null;

	chrome.runtime.onMessage.addListener(function(message) {

		if (message.method === '[AutomaticTabCleaner:RestoreMessage]') {
			if (message.anyWay)
				goBack();
			else
				chrome.tabs.getCurrent(function(tab) {
					if (message.tab.id == tab.id)
						goBack();
				});
		} else if (message.method === '[AutomaticTabCleaner:UpdateTabsSettings]') {
			if (message.restoreEvent != null)
				restoreEvent = message.restoreEvent;

			if (message.reloadTabOnRestore != null)
				reloadTabOnRestore = message.reloadTabOnRestore;

			if (message.parkBgColor != null)
				applyBackground('#' + message.parkBgColor);

			if (message.screenshotCssStyle != null)
				applysSreenshotCssStyle(message.screenshotCssStyle);

			if (message.restoreButtonView != null)
				applyRestoreButtonView(message.restoreButtonView);

			if (message.tabIconStatusVisualize != null) {
				tabIconStatusVisualize = message.tabIconStatusVisualize;
				createTitleAndIcon(true);
			}
		} else if (message.method === '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]') {
			// eslint-disable-next-line no-undef
			drawAddPageToWhiteListDialog();
		} else if (message.method === '[AutomaticTabCleaner:hideDialogRequetToTab]') {
			document.getElementById('ATCSDialogiFrame').parentElement.removeChild(document.getElementById('ATCSDialogiFrame'));
			document.getElementById('screen').style.filter = '';
			window.focus();

			if (message.options && message.options.goBack)
				goBack();
			else
				showNativeUrl();
		}
	});

	// eslint-disable-next-line no-unused-vars
	secondTime = isSecondTime();

	document.getElementById('title').onclick =
		document.getElementById('titleImg').onclick = function() {
			goBack();
			return false;
		};

	let url = parseUrlParam('url');

	if (url.indexOf('http://') == 0)
		url = url.substr(7);
	if (url.indexOf('https://') == 0)
		url = url.substr(8);

	document.getElementById('nativeUrlSpan').innerText = url;

	initNativeUrlAnimation();
}

function goBack(options) {

	chrome.runtime.sendMessage({
		'method': '[AutomaticTabCleaner:TabUnsuspended]',
		'targetTabId': tabId,
		'url': targetUrl
	});

	if (!backProcessed || options != null && options.force == true) {
		if (reloadTabOnRestore == false &&
			!isFromHistory() &&
			parkedUrl != null
			/* TODO: Rework this logic && window.history.length > 2 && !secondTime*/) {
			if (debug)
				console.log('Back');
			historyFallback(parseUrlParam('url'));
		} else {
			if (debug)
				console.log('Reload');
			window.location.replace(parseUrlParam('url'));
		}
	}
	backProcessed = true;
}

function historyFallback(fallbackUrl) {
	let hasHistory = false;

	window.onbeforeunload = function() {
		hasHistory = true;
	};

	window.history.go(-1);

	setInterval(function() {
		console.log('hasHistory: ' + hasHistory);
	}, 100);

	setTimeout(function() {
		if (hasHistory != true) {
			window.location.assign(fallbackUrl);
			if (debug)
				console.log('Force Back 500ms!!!');
		}
	}, 500);
}

window.startEX = startEX;


function isSecondTime() {
	let indexOfNumberSymbol = window.location.href.lastIndexOf('#');
	if (indexOfNumberSymbol != -1)
		if (location.href.substring(indexOfNumberSymbol) == '#secondTime')
			return true;
	return false;
}

function isFromHistory() {
	let indexOfNumberSymbol = window.location.href.lastIndexOf('#');
	if (indexOfNumberSymbol != -1)
		if (location.href.substring(indexOfNumberSymbol) == '#fromHistory')
			return true;
	return false;
}

let nativeUrlVisible = false;
let nativeUrlTimer = null;
let nativeUrlTimerClose = null;
let nativeUrlTimerCloseAfterTimeout = null;
let nativeUrlPosition;
let nativeUrlElement = document.getElementById('nativeUrl');
let nativeUrlElementHover = false;


let showNativeUrl;
let hideNativeUrl;

function initNativeUrlAnimation() {

	if (nativeUrlElement != null)
		return;

	let newNativeUrlElement = document.getElementById('nativeUrl');

	if (newNativeUrlElement == null)
		return;


	newNativeUrlElement.onmouseover = function() {
		nativeUrlElementHover = true;
		if (nativeUrlTimerCloseAfterTimeout)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);
	};

	newNativeUrlElement.onmouseout = function(event) {
		if (event) {
			let e = event.toElement || event.relatedTarget;
			if (e) {
				if ((e.parentNode == this || (e.parentNode != null && e.parentNode.parentNode == this) || e == this))
					return;
			}
		}

		nativeUrlElementHover = false;
		if (nativeUrlTimerCloseAfterTimeout)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);

		nativeUrlTimerCloseAfterTimeout = setTimeout(function() {
			hideNativeUrl();
		}, 5000);
	};


	hideNativeUrl = function() {
		if (nativeUrlVisible != true)
			return;

		nativeUrlTimer = null;

		nativeUrlTimerClose = setInterval(function() {
			newNativeUrlElement.style.top = --nativeUrlPosition + 'px';
			if (nativeUrlPosition <= -27) {
				nativeUrlVisible = false;
				clearInterval(nativeUrlTimerClose);
				nativeUrlTimerClose = null;
			}
		}, 10);
	};

	showNativeUrl = function(options) {
		if (!options || !options.permanent)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);
		nativeUrlTimerCloseAfterTimeout = null;

		if (!options || !options.permanent)
			hideNativeUrl();

		if (nativeUrlVisible != true && nativeUrlTimer == null) {
			window.getSelection().selectAllChildren(document.getElementById('nativeUrlSpan'));

			nativeUrlPosition = -27;
			nativeUrlTimer = setInterval(function() {
				newNativeUrlElement.style.top = ++nativeUrlPosition + 'px';

				if (nativeUrlPosition >= 0) {
					nativeUrlVisible = true;
					clearInterval(nativeUrlTimer);

					if (nativeUrlTimerCloseAfterTimeout)
						clearTimeout(nativeUrlTimerCloseAfterTimeout);
					if (!options || !options.permanent)
						nativeUrlTimerCloseAfterTimeout = setTimeout(function() {
							if (!nativeUrlElementHover)
								hideNativeUrl();
						}, 5000);
				}
			}, 9);
		}
	};

	document.getElementById('nativeUrlButton').onclick = showNativeUrl;
}

/************************/
/*     Util Methods     */
/************************/

window.drawAddPageToWhiteListDialog = function() {
	if (document.getElementById('ATCSDialogiFrame'))
		return;

	showNativeUrl({ permanent: true });

	document.getElementById('screen').style.filter = 'blur(1px)';

	let iframe = document.createElement('iframe');
	iframe.id = 'ATCSDialogiFrame';
	iframe.src = chrome.extension.getURL('dialog.html?dialog=page&url=' + parseUrlParam('url'));
	iframe.style.position = 'fixed';
	iframe.style.top = '0px';
	iframe.style.left = '0px';
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.zIndex = 10000000;
	iframe.frameBorder = 0;
	document.getElementsByTagName('body')[0].appendChild(iframe);
};
