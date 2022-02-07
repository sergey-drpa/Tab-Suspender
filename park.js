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
let DEBUG = false;
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
let screenPromise;
let faviconDrawed;

let loaded = new Promise((resolve) => {
	window.addEventListener('load', () => {
		if (debugPerformance)
			console.log('onload: ', Date.now());

		resolve();
	});
});

let DOMContentLoaded;
window.domLoadedPromise = new Promise((resolve) => {
	document.addEventListener('DOMContentLoaded', () => {
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
	chrome.runtime.getBackgroundPage((bgpage) => {
		if (debugPerformance)
			console.log('getBackgroundPage Loaded: ', Date.now());

		tabId = parseUrlParam('tabId');

		screenPromise = new Promise(resolve => {
			bgpage.getScreen(tabId, parseUrlParam('sessionId'), (scr, pixRat) => {
				resolve({ scr, pixRat });
			});
		});

		window.domLoadedPromise.then(() => {

			try {
				let isStartDiscarted = bgpage.getStartDiscarted();

				if(DEBUG) {
					console.log('bgpage.getStartDiscarted(): ', isStartDiscarted);
				}

				if (isStartDiscarted == true) {
					if ((Date.now() - bgpage.getStartedAt()) < 15000) {
						if(DEBUG) {
							console.log('(new Date().getTime() - bgpage.getStartedAt()) < 15000: ', (Date.now() - bgpage.getStartedAt()) < 15000);
						}
						if (bgpage.isFirstTimeTabDiscard(tabId)) {
							if(DEBUG) {
								console.log('bgpage.isFirstTimeTabDiscard(tabId): ', bgpage.isFirstTimeTabDiscard(tabId));
							}
							chrome.tabs.getCurrent((tab) => {
								if (tab.active === false) {
									if(DEBUG) {
										console.log('tab.active: ', tab.active);
									}
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

				applyRestoreButtonView(bgpage);
				//setTimeout(() => { drawContent(bgpage);}, 0);
				drawContent(bgpage);
				setTimeout(continueStart, 0);
			}

			/* CHECK IF TAB MARKED FOR UNSUSPEND */
			function continueCheck() {
				if (debugPerformance)
					console.log('Continue Chaeck: ', Date.now());

				chrome.tabs.getCurrent((tab) => {
					parkedUrl = bgpage.getTabInfo(tab).parkedUrl;
				});

				isTabMarkedForUnsuspend = bgpage.isTabMarkedForUnsuspend(tabId, parseUrlParam('sessionId'), { 'remove': true });
				if (DEBUG)
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

					//bgpage.getScreen(tabId, parseUrlParam('sessionId'), (scr, pixRat) => {
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
							setTimeout(() => { drawContent(bgpage);}, 0);
							//drawContent(bgpage);
							setTimeout(continueStart, 0);
						} catch (e) {
							console.error(e);

							//applyRestoreButtonView(bgpage);
							setTimeout(() => { drawContent(bgpage);}, 0);
							//drawContent(bgpage);
							setTimeout(continueStart, 0);
						}
					});

					if (debugPerformance)
						console.log('Apply background: ', Date.now());

					applysSreenshotCssStyle(bgpage.getScreenshotCssStyle());
					//applyRestoreButtonView(bgpage.getRestoreButtonView());
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

	window.domLoadedPromise.then(() => {
		applyRestoreButtonView();
		setTimeout(drawContent, 0);
		setTimeout(continueStart, 0);
	});
}

function applysUserDisplayHeight(height) {
	let resoteImg = document.getElementById('resoteImg');

	if(DEBUG) {
		console.log('DisplayHeight: ', height);
	}
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

function applyRestoreButtonView(bgpage, restoreButtonView) {
	restoreButtonView = restoreButtonView ? restoreButtonView : (bgpage ? bgpage.getRestoreButtonView() : null);

	let screen = document.getElementById('screen');
	let resroreImg = document.getElementById('resoteImg');

	let initOriginalUrlBlock = () => {
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

function createTitleAndIcon(force) {
	if(DEBUG) {
		console.log('createTitleAndIcon...');
	}

	if(faviconDrawed)
		return;

	if (title == null)
		title = parseUrlParam('title');
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
		generateFaviconUri(parseUrlParam('icon', false), (proccesedIcon) => {
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
	if(DEBUG) {
		console.log('generateFaviconUri...');
	}
	let img = new Image();
	let onCorruptedUrlTimeout = setTimeout(()=>{img.onerror();}, 3000);
	img.onload = () => {
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
		img.src = chrome.extension.getURL('img/new_page.png');
	};
	img.src = url && url != 'undefined' ? url : chrome.extension.getURL('img/new_page.png');

}

function drawWaterMark(canvas, ctx, width, callback) {
	if(DEBUG) {
		console.log('drawWaterMark...');
	}
	let img = new Image();
	if (width !== 64) {
		console.error('Unexpected: Favicon image != 64x64 -> ' + width);
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

function cssScale() {
	return 'scale(' + 1 / screenshotDevicePixelRatio + ', ' + 1 / screenshotDevicePixelRatio + ')';
}

function applyPixelRatio(screenImg) {

	try {
		if (DEBUG) {
			console.log('screenshotDevicePixelRatio: ', screenshotDevicePixelRatio);
		}
		if (screenshotDevicePixelRatio > 1)
			screenImg.style.transform = cssScale();
	} catch (e) {
		console.error(e);
	}
}

function drawContent(bgpage) {
	if (debugPerformance)
		console.log('Drow Content: ', Date.now());
	//createTitleAndIcon();
	let screenImg = document.getElementById('screen');

	screenImg.onload = () => {
		applyRestoreButtonView(bgpage);
		applyBackground('#' + bgpage.getParkBgColor());
	}
	screenImg.onerror = () => {
		applyRestoreButtonView(bgpage);
		applyBackground('#' + bgpage.getParkBgColor());
	}

	applyPixelRatio(screenImg);

	if (bgScreen == null) {
		screenImg.style.display = 'none';
		document.getElementById('title').innerHTML = title;
		document.getElementById('title').href = parseUrlParam('url');
		document.getElementById('favicon').src = favicon;
		document.getElementById('title_div').style.display = 'block';
		document.getElementById('nativeUrl').classList.add('visible');

		screenImg.onerror();
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
	});
}

function startEX() {
	if (debugPerformance)
		console.log('Start begun...!', Date.now());
	favicon = null;

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
			});
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
		document.getElementById('titleImg').onclick = () => {
			goBack();
			return false;
		};

	let url = parseUrlParam('url');
	let title = parseUrlParam('title');

	if (url.indexOf('http://') === 0)
		url = url.substr(7);
	if (url.indexOf('https://') === 0)
		url = url.substr(8);

	const nativeUrlSpan = document.getElementById('nativeUrlSpan');
	nativeUrlSpan.innerText = url;
	nativeUrlSpan.title = `Title: "${title}"`;

	initNativeUrlAnimation();
}

function goBack(options) {

	chrome.runtime.sendMessage({
		'method': '[AutomaticTabCleaner:TabUnsuspended]',
		'targetTabId': tabId,
		'url': targetUrl
	});

	if (!backProcessed || options != null && options.force === true) {
		if (reloadTabOnRestore === false &&
			!isFromHistory() &&
			parkedUrl != null
			/* TODO: Rework this logic && window.history.length > 2 && !secondTime*/) {
			if (DEBUG)
				console.log('Back');
			historyFallback(parseUrlParam('url'));
		} else {
			if (DEBUG)
				console.log('Reload');
			window.location.replace(parseUrlParam('url'));
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


	newNativeUrlElement.onmouseover = () => {
		nativeUrlElementHover = true;
		if (nativeUrlTimerCloseAfterTimeout)
			clearTimeout(nativeUrlTimerCloseAfterTimeout);
	};

	newNativeUrlElement.onmouseout = (event) => {
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
		return new Promise((resolve, reject) => {
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
		});
	};


	document.getElementById('settingsBtn').onclick = () => {

		if(document.getElementById('options').style.display === 'none') {
			document.getElementById('options').style.display = 'block';

			Promise.all([
				loadJsCssFile('lib/coloris/coloris.min.js', 'js'),
				loadJsCssFile('lib/coloris/coloris.min.css', 'css'),
				loadJsCssFile('part-options.css', 'css'),
			]).then(() => {
				chrome.runtime.getBackgroundPage((bgpage) => {

					/* Blue Circle options */
					const restoreButtonView = bgpage.getRestoreButtonView();
					const showRestoreButtonChecked = (restoreButtonView === 'roundIcon');
					document.getElementById('showCircleInput').checked = showRestoreButtonChecked;
					document.getElementById('showCircleInput').onchange = () => {
						const restoreButtonView = (document.getElementById('showCircleInput').checked ? 'roundIcon' : 'noIcon');
						chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', restoreButtonView: restoreButtonView });
					}


					/* Color Option */
					document.getElementById('colorisInput').value = '#' + bgpage.getParkBgColor();
					// eslint-disable-next-line no-undef
					Coloris({
						el: '.coloris'
					});
					document.getElementById('colorisInput').oninput = () => {
						const parkBgColor = document.getElementById('colorisInput').value.split('#');
						if(parkBgColor.length >= 1)
							chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', parkBgColor: parkBgColor[1] });
					}

					/* All Settings */
					document.getElementById('allSettings').onclick = () => {
						chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:OpenSettingsPage]' });
					};

				});
			});

		} else {
			document.getElementById('options').style.display = 'none';
		}
	}
}

/************************/
/*     Util Methods     */
/************************/

window.drawAddPageToWhiteListDialog = () => {
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
