/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
'use strict';

void (async ()=>{
// eslint-disable-next-line no-redeclare
const DEBUG = true;
const debugPerformance = true;

if (debugPerformance) {
	console.log('Compiled inside: ', Date.now());
	console.time('Load time...');
}

//const urlParamChache = {};
let backProcessed = false;
let title;
let favicon;
let link;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
let screenPromise;
let faviconDrawed;
let globalParkData: ParkPageDataBGResponse;

const url: URL = new URL(window.location.href);
const searchParams: URLSearchParams = url.searchParams;

const loaded = new Promise<void>((resolve) => {
	window.addEventListener('load', () => {
		if (debugPerformance)
			console.log('onload: ', Date.now());

		resolve();
	});
});

let DOMContentLoaded;
// @ts-expect-error
window.domLoadedPromise = new Promise<void>((resolve) => {
	document.addEventListener('DOMContentLoaded', () => {
		if(DOMContentLoaded) return;
		DOMContentLoaded = true;

		if (debugPerformance)
			console.log('onDOMContentLoaded: ', Date.now());

		try {
			createTitleAndIcon();
			applysUserDisplayHeight(window.innerHeight);
			// eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
		} catch (e) {
		}

		resolve();
	}, true);
});



if (debugPerformance)
	console.log('getBackgroundPage: ', Date.now());

try {

	tabId = searchParams.get('tabId');

	screenPromise = chrome.runtime.sendMessage({ method: '[TS:getScreen]', tabId, sessionId: searchParams.get('sessionId') });

	const parkData: ParkPageDataBGResponse = await chrome.runtime.sendMessage({ method: '[TS:dataForParkPage]', tabId, sessionId: searchParams.get('sessionId') }); //.then((parkData: ParkPageDataBGResponse) => {

		globalParkData = parkData;

		// @ts-expect-error
		window.domLoadedPromise.then(() => {

			try {

				if(DEBUG) {
					console.log('bgpage.getStartDiscarted(): ', parkData.startDiscarded);
				}

				if (parkData.startDiscarded == true) {
					if ((Date.now() - parkData.startAt) < 15000) {
						if(DEBUG) {
							console.log('(new Date().getTime() - bgpage.getStartedAt()) < 15000: ', (Date.now() - parkData.startAt) < 15000);
						}
						if (parkData.isFirstTimeTabDiscard) {
							if(DEBUG) {
								console.log('bgpage.isFirstTimeTabDiscard(tabId): ', parkData.isFirstTimeTabDiscard);
							}
							chrome.tabs.getCurrent((tab) => {
								if (tab.active === false) {
									if(DEBUG) {
										console.log('tab.active: ', tab.active);
									}
									window.stop();
									chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:DiscardTab]' }).catch(console.error);
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

				applyRestoreButtonView(parkData);
				//setTimeout(() => { drawContent(bgpage);}, 0);
				drawContent(parkData);
				setTimeout(continueStart, 0);
			}

			/* CHECK IF TAB MARKED FOR UNSUSPEND */
			function continueCheck() {
				if (debugPerformance)
					console.log('Continue Check: ', Date.now());

				parkedUrl = parkData.parkedUrl;

				isTabMarkedForUnsuspend = parkData.isTabMarkedForUnsuspend;

				if (DEBUG)
					console.log('isTabMarkedForUnsuspend: ', isTabMarkedForUnsuspend);

				if (isTabMarkedForUnsuspend) {
					document.getElementById('resoteImg').style.display = 'none';
					document.getElementById('topRestore').style.display = 'none';
					reloadTabOnRestore = parkData.reloadTabOnRestore;
					setTimeout(continueStart, 0);
				} else {
					if (debugPerformance)
						console.log('Get Screen: ', Date.now());

					tabIconStatusVisualize = parkData.tabIconStatusVisualize;
					tabIconOpacityChange = parkData.tabIconOpacityChange;

					screenPromise.then(({scr, pixRat}) => {
						try {
							if (debugPerformance)
								console.log('Get Screen Loaded: ', Date.now());

							if(scr == null) {
								throw new Error('Screen image is null!');
							}

							bgScreen = scr;
							if (!pixRat) {
								screenshotDevicePixelRatio = window.devicePixelRatio;
							} else {
								screenshotDevicePixelRatio = pixRat;
							}
							/* EXPERIMANTAL */
							setTimeout(() => { drawContent(parkData);}, 0);
							//drawContent(bgpage);
							setTimeout(continueStart, 0);
						} catch (e) {
							console.error(e);

							//applyRestoreButtonView(bgpage);
							setTimeout(() => { drawContent(parkData);}, 0);
							//drawContent(bgpage);
							setTimeout(continueStart, 0);
						}
					}).catch((e) => {
						console.error('screenPromise failed or timeout:', e);
						// Continue rendering page without screenshot
						setTimeout(() => { drawContent(parkData);}, 0);
						setTimeout(continueStart, 0);
					});

					if (debugPerformance)
						console.log('Apply background: ', Date.now());

					applysSreenshotCssStyle(parkData.screenshotCssStyle);
					//applyRestoreButtonView(bgpage.getRestoreButtonView());
					restoreEvent = parkData.restoreEvent;
					reloadTabOnRestore = parkData.reloadTabOnRestore;

					createTitleAndIcon(true);
				}
			}
		});

		// @ts-expect-error
		window.domLoadedPromise = null;
	//}).catch(console.error);
} catch (e) {
	console.error(e);

	// @ts-expect-error
	window.domLoadedPromise.then(() => {
		applyRestoreButtonView();
		setTimeout(drawContent, 0);
		setTimeout(continueStart, 0);
	});
}

function applysUserDisplayHeight(height) {
	const restoreImg = document.getElementById('resoteImg');

	if(DEBUG) {
		console.log('DisplayHeight: ', height);
	}
	if (height != null) {
		if (height <= 600) {
			// @ts-expect-error
			restoreImg.width = '128';
			// @ts-expect-error
			restoreImg.height = '128';
			restoreImg.classList.add('h600');
		} else if (height <= 800) {
			// @ts-expect-error
			restoreImg.width = '160';
			// @ts-expect-error
			restoreImg.height = '160';
			restoreImg.classList.add('h800');
		} else if (height <= 1024) {
			// @ts-expect-error
			restoreImg.width = '196';
			// @ts-expect-error
			restoreImg.height = '196';
			restoreImg.classList.add('h1024');
		}
	}

	restoreImg.classList.remove('wait-for-render');
}

function applyRestoreButtonView(parkData?, restoreButtonView?) {
	restoreButtonView = restoreButtonView ? restoreButtonView : (parkData ? parkData.restoreButtonView : null);

	const screen = document.getElementById('screen');
	const resroreImg = document.getElementById('resoteImg');

	const initOriginalUrlBlock = () => {
		/* Native Url Block */
		document.body.classList.add('always-visible');
		document.getElementById('nativeUrlSpan').onclick /*= document.getElementById('nativeUrl').onclick*/ = () => {
			window.getSelection().selectAllChildren(document.getElementById('nativeUrlSpan'));
		};
	};

	if (restoreButtonView == null || restoreButtonView === 'roundIcon') {
		resroreImg.style.display = 'block';
		resroreImg.style.opacity = null;
		document.getElementById('topRestore').style.display = 'none';

		initOriginalUrlBlock();

		resroreImg.onmouseover = () => {
			if (restoreEvent === 'hover') {
				goBack();
				resroreImg.className = 'restore inprogress';
				screen.classList.add('inprogress');
			}
		};

		resroreImg.onclick = () => {
			if (restoreEvent === 'click') {
				goBack();
				resroreImg.className = 'restore inprogress';
				screen.classList.add('inprogress');
			}
		};
	} else if (restoreButtonView === 'topBar') {
		resroreImg.style.display = 'none';
		document.getElementById('topRestore').style.display = 'block';

		document.getElementById('topRestore').onclick = () => {
			goBack();
			document.getElementById('topRestore').className = 'topRestore inprogress';
			screen.classList.add('inprogress');
		};
	} else if (restoreButtonView === 'noIcon') {
		resroreImg.style.display = 'none';
		document.getElementById('topRestore').style.display = 'none';

		initOriginalUrlBlock();
	}

	document.getElementById('screenDiv').onclick = () => {
		goBack();
		resroreImg.className = 'restore inprogress';
		screen.classList.add('inprogress');
	};
}

function applyBackground(color) {
	document.body.style.background = color;
}

function applysSreenshotCssStyle(cssText) {
	const screenImgElement = document.getElementById('screen');
	screenImgElement.style.cssText = cssText;
	applyPixelRatio(screenImgElement);
}

function applyScreenshotsVisibility(screenshotsEnabled) {
	const screenImg = document.getElementById('screen');
	if (screenshotsEnabled) {
		// Show screenshots - remove no-screenshot class and show screen element
		document.body.classList.remove('no-screenshot');
		screenImg.style.display = '';
		document.getElementById('title_div').style.display = 'none';
		document.getElementById('nativeUrl').classList.remove('visible');
	} else {
		// Hide screenshots - add no-screenshot class and hide screen element
		document.body.classList.add('no-screenshot');
		screenImg.style.display = 'none';
		document.getElementById('title_div').style.display = 'block';
		document.getElementById('nativeUrl').classList.add('visible');
		// Update title and favicon if available
		if (title) {
			document.getElementById('title').textContent = title;
			// @ts-expect-error
			document.getElementById('title').href = new URLSearchParams(window.location.search).get('url');
		}
		if (favicon) {
			// @ts-expect-error
			document.getElementById('favicon').src = favicon;
		}
	}
}

function createTitleAndIcon(force?) {
	if(DEBUG) {
		console.log('createTitleAndIcon...');
	}

	if(faviconDrawed)
		return;

	if (title == null)
		title = searchParams.get('title');
	if (document.title !== title)
		document.title = title;

	link = document.getElementById('faviconLink');

	if (link != null && !force)
		if (link.href != null && link.href.indexOf('img/icon16_off.png') === -1)
			return;

	if (link == null) {
		link = document.createElement('link');
		link.type = 'image/x-icon';
		link.rel = 'shortcut icon';
	}

	if (favicon == null || force) {
		generateFaviconUri(searchParams.get('icon'/*, false*/), (proccesedIcon) => {
			favicon = proccesedIcon;
			link.href = proccesedIcon;
			if (link.id !== 'faviconLink') {
				link.id = 'faviconLink';
				document.getElementsByTagName('head')[0].appendChild(link);
			}
		});
		faviconDrawed = true;
	} else {
		if (favicon != null) {
			link.href = favicon;
		}
	}
}

// eslint-disable-next-line no-redeclare
/*function parseUrlParam(name, doNotCache?) {
	let val;
	if ((val = urlParamChache[name]) != null)
		return val;

	let tmp = [];
	const parts = window.location.search.substr(1).split('&');

	for (let i = 0; i < parts.length; i++) {
		tmp = parts[i].split('=');
		if (tmp[0] === name) {
			if (doNotCache === true)
				return decodeURIComponent(tmp[1]);
			else
				return urlParamChache[name] = decodeURIComponent(tmp[1]);
		}
	}
}*/

function generateFaviconUri(url, callback) {
	if(DEBUG) {
		console.log('generateFaviconUri...');
	}
	const img = new Image();
	const onCorruptedUrlTimeout = setTimeout(()=>{img.onerror(null);}, 3000);
	img.onload = () => {
		clearTimeout(onCorruptedUrlTimeout);
		const canvas = window.document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		const ctx = canvas.getContext('2d');
		if(tabIconOpacityChange){
			ctx.globalAlpha = 0.65;
		} else {
			ctx.globalAlpha = 1;
		}
		ctx.drawImage(img, 0, 0);
		if(DEBUG)
			console.log('tabIconStatusVisualize: ' + tabIconStatusVisualize);
		if (tabIconStatusVisualize) {
			drawWaterMark(canvas, ctx, img.width, callback);
		} else {
			callback(canvas.toDataURL());
		}
	};
	img.onerror = (e) => {
		clearTimeout(onCorruptedUrlTimeout);
		console.log('Loading Favicon Error', e);
		img.src = chrome.runtime.getURL('img/new_page.png');
	};
	img.src = url && url != 'undefined' ? url : chrome.runtime.getURL('img/new_page.png');

}

function drawWaterMark(canvas, ctx, width, callback) {
	if(DEBUG) {
		console.log('drawWaterMark...');
	}
	const img = new Image();
	if (width !== 64) {
		console.error('Unexpected: Favicon image != 64x64 -> ', width);
		callback(canvas.toDataURL());
		return;
	}
	img.onload = () => {
		ctx.globalAlpha = 0.95;

		ctx.drawImage(img, 49, 49);
		callback(canvas.toDataURL());
	};
	img.src = 'img/watermark/Circle_Blue_16_Brite_100.png';
}

function cssScale(): string {

	if (DEBUG) {
		console.log('screenshotDevicePixelRatio: ', screenshotDevicePixelRatio);
	}

	// Guard: if screenshotDevicePixelRatio is not set yet, use window.devicePixelRatio as fallback
	const pixelRatio = screenshotDevicePixelRatio ?? window.devicePixelRatio ?? 1;

	if (pixelRatio != 1 || globalParkData?.tabInfo?.zoomFactor != 1) {
		let scale = 1 / pixelRatio;
		if (globalParkData?.tabInfo?.zoomFactor != null && globalParkData.tabInfo.zoomFactor != 1) {
			scale *= globalParkData.tabInfo.zoomFactor;
		}
		return 'scale(' + scale + ', ' + scale + ')';
	}
	return '';
}

function applyPixelRatio(screenImg) {

	try {
		screenImg.style.transform = cssScale();
	} catch (e) {
		console.error(e);
	}
}

function drawContent(parkData) {
	if (debugPerformance)
		console.log('Draw Image started: ', Date.now());
	//createTitleAndIcon();
	const screenImg = document.getElementById('screen');

	screenImg.onload = () => {
		if (debugPerformance)
			console.log('Image finally showed: ', Date.now());

		applyRestoreButtonView(parkData);
		applyBackground('#' + parkData.parkBgColor);
	}
	screenImg.onerror = () => {
		applyRestoreButtonView(parkData);
		applyBackground('#' + parkData.parkBgColor);
	}

	applyPixelRatio(screenImg);

	if (bgScreen == null) {
		// Enhanced text-only mode when screenshots are disabled
		screenImg.style.display = 'none';
		document.body.classList.add('no-screenshot');
		document.getElementById('title').textContent = title;
		// @ts-expect-error
		document.getElementById('title').href = searchParams.get('url');
		// @ts-expect-error
		document.getElementById('favicon').src = favicon;
		document.getElementById('title_div').style.display = 'block';
		document.getElementById('nativeUrl').classList.add('visible');

		screenImg.onerror(null);
	} else
		// @ts-expect-error
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
		if (DEBUG)
			console.log('Prepare to go Back!');

		goBack({ force: true });

		return;
	}

	/****
	 * TODO: Looks like document.readyState === "complete" != window.addEventListener('load'
	 */
	if(DEBUG) {
		console.log('Waiting for Page load...', Date.now());
	}
	loaded.then(()=>{
		if(DEBUG) {
			console.log('Page Already loaded');
		}
		startEX();
	}).catch(console.error);
}

chrome.runtime.onMessage.addListener((message) => {

	if (message.method === '[AutomaticTabCleaner:RestoreMessage]') {
		if (message.anyWay)
			goBack();
		else
			chrome.tabs.getCurrent((tab) => {
				if (message.tab.id == tab.id)
					goBack();
			});
	} else if (message.method === '[AutomaticTabCleaner:UpdateTabsSettings]') {
		loaded.then(() => {
			if (message.restoreEvent != null)
				restoreEvent = message.restoreEvent;

			if (message.reloadTabOnRestore != null)
				reloadTabOnRestore = message.reloadTabOnRestore;

			if (message.parkBgColor != null)
				applyBackground('#' + message.parkBgColor);

			if (message.screenshotCssStyle != null)
				applysSreenshotCssStyle(message.screenshotCssStyle);

			if (message.restoreButtonView != null)
				applyRestoreButtonView(null, message.restoreButtonView);

			if (message.tabIconStatusVisualize != null) {
				tabIconStatusVisualize = message.tabIconStatusVisualize;
				createTitleAndIcon(true);
			}

			if (message.screenshotsEnabled != null) {
				applyScreenshotsVisibility(message.screenshotsEnabled);
			}
		}).catch(console.error);
	} else if (message.method === '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]') {
		// @ts-expect-error
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

function startEX() {
	if (debugPerformance)
		console.log('Start begun...!', Date.now());
	favicon = null;

	// eslint-disable-next-line no-unused-vars
	secondTime = isSecondTime();

	document.getElementById('title').onclick =
		document.getElementById('titleImg').onclick = () => {
			goBack();
			return false;
		};

	let url = searchParams.get('url');
	const title = searchParams.get('title');

	if (url.indexOf('http://') === 0)
		url = url.substr(7);
	if (url.indexOf('https://') === 0)
		url = url.substr(8);

	const nativeUrlSpan = document.getElementById('nativeUrlSpan');
	nativeUrlSpan.innerText = url;
	nativeUrlSpan.title = `Title: "${title}"`;

	initNativeUrlAnimation();
}

function goBack(options?) {

	targetUrl = searchParams.get('url');

	chrome.runtime.sendMessage({
		'method': '[AutomaticTabCleaner:TabUnsuspended]',
		'targetTabId': tabId,
		'url': targetUrl
	}).catch(console.error);

	if (!backProcessed || options != null && options.force === true) {
		if (reloadTabOnRestore === false &&
			!isFromHistory() &&
			parkedUrl != null
			/* TODO: Rework this logic && window.history.length > 2 && !secondTime*/) {
			if (DEBUG)
				console.log('Back');
			historyFallback(targetUrl);
		} else {
			if (DEBUG)
				console.log('Reload');
			window.location.replace(targetUrl);
		}
	}
	backProcessed = true;
}

function historyFallback(fallbackUrl) {
	let hasHistory = false;

	window.onbeforeunload = () => {
		hasHistory = true;
	};

	window.history.go(-1);

	if(DEBUG) {
		setInterval(() => {
			console.log('hasHistory: ' + hasHistory);
		}, 100);
	}

	setTimeout(() => {
		if (hasHistory != true) {
			window.location.assign(fallbackUrl);
			if (DEBUG)
				console.log('Force Back 500ms!!!');
		}
	}, 500);
}

// @ts-expect-error
window.startEX = startEX;


function isSecondTime() {
	const indexOfNumberSymbol = window.location.href.lastIndexOf('#');
	if (indexOfNumberSymbol != -1)
		if (location.href.substring(indexOfNumberSymbol) == '#secondTime')
			return true;
	return false;
}

function isFromHistory() {
	const indexOfNumberSymbol = window.location.href.lastIndexOf('#');
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
let nativeUrlElement;
let nativeUrlElementHover = false;


let showNativeUrl;
let hideNativeUrl;

function initNativeUrlAnimation() {

	if (nativeUrlElement != null)
		return;

	const newNativeUrlElement = document.getElementById('nativeUrl');

	if (newNativeUrlElement == null)
		return;


	newNativeUrlElement.onmouseover = () => {
		nativeUrlElementHover = true;
		if (nativeUrlTimerCloseAfterTimeout)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);
	};

	newNativeUrlElement.onmouseout = (event) => {
		if (event) {
			// @ts-expect-error
			const e = event.toElement || event.relatedTarget;
			if (e) {
				if ((e.parentNode == this || (e.parentNode != null && e.parentNode.parentNode == this) || e == this))
					return;
			}
		}

		nativeUrlElementHover = false;
		if (nativeUrlTimerCloseAfterTimeout)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);

		nativeUrlTimerCloseAfterTimeout = setTimeout(() => {
			hideNativeUrl();
		}, 5000);
	};


	hideNativeUrl = () => {
		if (nativeUrlVisible != true)
			return;

		nativeUrlTimer = null;

		nativeUrlTimerClose = setInterval(() => {
			newNativeUrlElement.style.top = --nativeUrlPosition + 'px';
			if (nativeUrlPosition <= -27) {
				nativeUrlVisible = false;
				clearInterval(nativeUrlTimerClose);
				nativeUrlTimerClose = null;
			}
		}, 10);
	};

	showNativeUrl = (options) => {
		if (!options || !options.permanent)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);
		nativeUrlTimerCloseAfterTimeout = null;

		if (!options || !options.permanent)
			hideNativeUrl();

		if (nativeUrlVisible != true && nativeUrlTimer == null) {
			window.getSelection().selectAllChildren(document.getElementById('nativeUrlSpan'));

			nativeUrlPosition = -27;
			nativeUrlTimer = setInterval(() => {
				newNativeUrlElement.style.top = ++nativeUrlPosition + 'px';

				if (nativeUrlPosition >= 0) {
					nativeUrlVisible = true;
					clearInterval(nativeUrlTimer);

					if (nativeUrlTimerCloseAfterTimeout)
						clearTimeout(nativeUrlTimerCloseAfterTimeout);
					if (!options || !options.permanent)
						nativeUrlTimerCloseAfterTimeout = setTimeout(() => {
							if (!nativeUrlElementHover)
								hideNativeUrl();
						}, 5000);
				}
			}, 9);
		}
	};

	document.getElementById('nativeUrlButton').onclick = showNativeUrl;


	const loadJsCssFile = (filename, filetype) => {
		return new Promise<void>((resolve, reject) => {
			let fileRef;
			if (filetype === "js") { //if filename is a external JavaScript file
				fileRef = document.createElement('script')
				fileRef.setAttribute("type", "text/javascript")
				fileRef.setAttribute("src", filename);
				fileRef.onload = () => {
					resolve();
				};
			} else if (filetype === "css") { //if filename is an external CSS file
				fileRef = document.createElement("link")
				fileRef.setAttribute("rel", "stylesheet")
				fileRef.setAttribute("type", "text/css")
				fileRef.setAttribute("href", filename);
				fileRef.onload = () => {
					resolve();
				};
			}
			if (typeof fileRef != "undefined")
				document.getElementsByTagName("head")[0].appendChild(fileRef);
			else
				reject();
		});
	}

	/* Load Main Menu */
	document.getElementById('pauseIcon').onclick = () => {
		Promise.all([loadJsCssFile('utils.js', 'js')])
			.then(() => {

				// @ts-ignore
				const isDarkMode = window.isDarkMode();

				const mainMenuDiv = document.createElement('div');
				const mainMenuOverlay = document.createElement('div');
				mainMenuOverlay.style.cssText = `position: fixed;
				top: 0%;
				left: 0%;
				width: 100%;
				height: 100%;
				background-color: #555;
				z-index: 1000;
				opacity: .40;`;
				const mainMenuDivInner = document.createElement('div');
				if(isDarkMode) {
					mainMenuDivInner.classList.add('blackThemeInner');
				}
				mainMenuDivInner.style.cssText = `border-radius: 10px;
				overflow: hidden;
				background-color: #fff`;

				const mainMenuIframe = document.createElement('iframe');
				mainMenuIframe.src = "./popup.html?showSessions=no";
				mainMenuIframe.style.cssText = `border: 0px;
				width: 300px;
				height: 423px;`;
				mainMenuDivInner.appendChild(mainMenuIframe);

				if(isDarkMode) {
					mainMenuDiv.classList.add('blackTheme');
				}
				mainMenuDiv.classList.add('mainMenuDiv');
				mainMenuDiv.style.cssText = `position: absolute;
				z-index: 1001;
				top: 47px;
				left: 25px;
				height: 100%;
				width: 300px;
				/*border-radius: 10px;
				overflow: hidden;*/`;
				mainMenuDiv.appendChild(mainMenuDivInner);
				document.body.classList.add('blur');
				document.body.parentElement.appendChild(mainMenuDiv);
				document.body.parentElement.appendChild(mainMenuOverlay);

				mainMenuOverlay.onclick = () => {
					mainMenuDiv.parentElement.removeChild(mainMenuDiv);
					mainMenuOverlay.parentElement.removeChild(mainMenuOverlay);
					document.body.classList.remove('blur');
				}
		}).catch(console.error);
	};


	document.getElementById('settingsBtn').onclick = () => {

		if(document.getElementById('options').style.display === 'none') {
			document.getElementById('options').style.display = 'block';

			Promise.all([
				loadJsCssFile('lib/coloris/coloris.min.js', 'js'),
				loadJsCssFile('lib/coloris/coloris.min.css', 'css'),
				loadJsCssFile('part-options.css', 'css'),
			]).then(() => {
				//chrome.runtime.getBackgroundPage((bgpage) => {

					/* Blue Circle options */
					//const restoreButtonView = bgpage.getRestoreButtonView();
					const showRestoreButtonChecked = (globalParkData.restoreButtonView === 'roundIcon');
					// @ts-expect-error
					document.getElementById('showCircleInput').checked = showRestoreButtonChecked;
					document.getElementById('showCircleInput').onchange = () => {
						// @ts-expect-error
						const restoreButtonView = (document.getElementById('showCircleInput').checked ? 'roundIcon' : 'noIcon');
						chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', restoreButtonView: restoreButtonView }).catch(console.error);
					}


					/* Color Option */ // @ts-expect-error
					document.getElementById('colorisInput').value
						= '#' + globalParkData.parkBgColor;
					// @ts-expect-error
					Coloris({
						el: '.coloris'
					});
					document.getElementById('colorisInput').oninput = () => {
						// @ts-expect-error
						const parkBgColor = document.getElementById('colorisInput').value.split('#');
						if(parkBgColor.length >= 1)
							chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', parkBgColor: parkBgColor[1] }).catch(console.error);
					}

					/* All Settings */
					document.getElementById('allSettings').onclick = () => {
						chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:OpenSettingsPage]' }).catch(console.error);
					};

				//});
			}).catch(console.error);

		} else {
			document.getElementById('options').style.display = 'none';
		}
	}
}

/************************/
/*     Util Methods     */
/************************/

// @ts-expect-error
window.drawAddPageToWhiteListDialog = () => {
	if (document.getElementById('ATCSDialogiFrame'))
		return;

	showNativeUrl({ permanent: true });

	document.getElementById('screen').style.filter = 'blur(1px)';

	const iframe = document.createElement('iframe');
	iframe.id = 'ATCSDialogiFrame';
	iframe.src = chrome.runtime.getURL('dialog.html?dialog=page&url=' + searchParams.get('url'));
	iframe.style.position = 'fixed';
	iframe.style.top = '0px';
	iframe.style.left = '0px';
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.zIndex = String(10000000);
	iframe.frameBorder = 'none';
	document.getElementsByTagName('body')[0].appendChild(iframe);
};
})();
