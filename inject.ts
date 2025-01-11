/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 * @fileoverview
 * @suppress {globalThis|checkVars}
 */

/* Definitions for Syntax Check */
// eslint-disable-next-line no-redeclare
//window.chrome = window.chrome || {};
// eslint-disable-next-line no-redeclare
//window.html2canvas = window.html2canvas || {};


document.addEventListener('DOMContentLoaded', function() {
	window.focus();
}, true);

(function() {
	'use strict';

	/* General */
	const ICON_DIMENSION = 16;
	const WIZARD_FRAME_ID = 'ATCSDialogWizadriFrame';
	const ADD_TO_WHITELIST_FRAME_ID = 'ATCSDialogiFrame';
	const waitWindow = 1000;
	let count = 0;
	const debug = false;

	let lockImg = null;
	const notCompleteInputs = [];

	resotreForm();

	/**
	 * Rize event
	 */
	function riseEvent() {
		if (count >= 2)
			return false;
		count++;
		return true;
	}

	const changeEventCallback = function() {
		chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:TabChangedRequestFromInject]' });
	};

	const onevent = function(e) {
		if (riseEvent())
			dropEvent(e);
	};

	function resotreForm() {
		chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:getFormRestoreDataAndRemove]' }, function(response) {
			if (response == null) {
				return;
			}

			if (window.location.href != response.url) {
				return;
			}

			const formDataToRestore = response.formData;


			//TODO: Test on this case: http://obraz.pro/register/#registration

			processRestoreForm(formDataToRestore);
		});
	}

	function errorLog(exception) {
		chrome.runtime.sendMessage({
			'method': '[AutomaticTabCleaner:trackError]',
			message: 'Error in Inject: ' + (exception ? exception.message : ''),
			stack: (exception ? exception.stack : '')
		});
	}

	function fireEvent(domElement, eventCode) {
		const evt = document.createEvent('HTMLEvents');
		evt.initEvent(eventCode, false, true);
		domElement.dispatchEvent(evt);
	}


	/**
	 * Down event
	 */
	let interval = null;
	const dropEventIntervalController = function() {
		if (count == 0) {
			if (interval != null) {
				clearInterval(interval);
				interval = null;
			}
			return;
		}

		count--;

		if (count == 0) {
			if (interval != null) {
				clearInterval(interval);
				interval = null;
			}
			changeEventCallback();
		}
	};

	function dropEvent(e) {
		if (e != null && e.type === 'load') {
			count--;
			changeEventCallback();
		} else {
			if (count == 0)
				return;

			if (interval == null) {
				interval = setInterval(dropEventIntervalController, waitWindow / 2);
			}
		}
	}

	function calcNotCompleteInputsLength() {
		let totalScore = 0;
		for (const i in notCompleteInputs) {
			if (notCompleteInputs[i].type === 'textarea')
				totalScore += 3;
			else
				totalScore += 1;
		}
		return totalScore;
	}

	document.body.addEventListener('change', function(e) {
		//@ts-ignore
		if (e.target.tagName != null && (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'textarea') && e.target.hidden != true) {
			if (calcNotCompleteInputsLength() <= 3) {
				for (const i in notCompleteInputs) {
					if (!document.body.contains(notCompleteInputs[i]) || notCompleteInputs[i].value == null || notCompleteInputs[i].value == '') {
						const element = notCompleteInputs.splice(Number(i), 1);
						if (debug)
							console.log('Input removed: ', element);
						chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:UnmarkPageAsNonCompleteInput]' });
					}
				}
			}

			if (calcNotCompleteInputsLength() > 2)
				return;

			for (const i in notCompleteInputs)
				if (notCompleteInputs[i] === e.target)
					return;

			//@ts-ignore
			if (e.target.value != null && e.target.value != '')
				notCompleteInputs.push(e.target);

			if (calcNotCompleteInputsLength() > 2) {
				chrome.runtime.sendMessage({ 'method': '[AutomaticTabCleaner:MarkPageAsNonCompleteInput]' });
				if (debug)
					console.log('Input Changed 3 times: Page Marked As Non Complete');
			}
		}
	}, true);

	document.addEventListener('scroll', onevent, true);
	document.addEventListener('click', onevent, true);
	window.addEventListener('resize', onevent, true);
	document.addEventListener('keypress', onevent, true);
	window.addEventListener('load', onevent, true);

	let suspendedPagesUrls = [];

	chrome.runtime.onMessage.addListener(function(request: any, sender, sendResponse) {
		if (request.method === '[AutomaticTabCleaner:backupSuspendedPagesUrls]') {
			suspendedPagesUrls = request.suspendedUrls;
			console.log('susPgsUrls: ', suspendedPagesUrls.length);
		}
		if (request.method === '[AutomaticTabCleaner:ParkPageFromInject]') {
			const _request: RequestParkPageFromInject = request as RequestParkPageFromInject;
			const closureTabId = _request.tabId;
			const width = _request.width;
			const height = _request.height;
			/* Try to change origin */
			try {
				const elements = document.getElementsByTagName('img');
				for (let i = 0; i < elements.length; i++) {
					elements[i].setAttribute('crossOrigin', 'Anonymous');
				}
			} catch (e) {
				console.error('[AutomaticTabCleaner:ParkPageFromInject]: ', e);
			}

			if (width != null)
				document.body.style.width = width + 'px';

			// @ts-ignore
			html2canvas(document.body, {
				'onrendered': async function(canvas) {
					document.body.appendChild(canvas);

					try {
						let url = chrome.runtime.getURL('park.html') + '?title=' + encodeURIComponent(document.title);
						url += '&url=' + encodeURIComponent(_request.url ? _request.url : window.location.href);
						url += '&tabId=' + encodeURIComponent(closureTabId);
						url += '&sessionId=' + encodeURIComponent(_request.sessionId);
						url += '&icon=' + encodeURIComponent(getOriginalFaviconUrl());

						await chrome.runtime.sendMessage(canvas.toDataURL("image/jpeg", _request.screenshotQuality/100));

						await chrome.runtime.sendMessage({
							'method': '[AutomaticTabCleaner:ParkPageFromInjectFinished]',
							'url': url,
							'tabId': closureTabId
						});

						sendResponse({ result: 'successful' });
					} catch (e) {
						console.error('Failed to process `html2canvas` result: ', e);
						sendResponse({ result: 'fail', error: e });
					}
				}}/*,
				'width': (width != null ? width : window.outerWidth),//window.innerWidth,
				'height': (window.outerHeight > 0 ? window.outerHeight : height)//window.innerHeight//  //document.height
			}*/);
			return true;
		} else if (request.method === '[AutomaticTabCleaner:getOriginalFaviconUrl]') {
			sendResponse(getOriginalFaviconUrl());
		} else if (request.method === '[AutomaticTabCleaner:highliteFavicon]') {
			setTimeout(function() {
				highlite(request.highliteInfo);
			}, 0);
		} else if (request.method === '[AutomaticTabCleaner:CollectPageState]') {
			sendResponse({ formData: hebernateFormData(), videoTime: collectVideoTime() });
		} else if (request.method === '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]') {
			drawAddPageToWhiteListDialog();
		} else if (request.method === '[AutomaticTabCleaner:hideDialogRequetToTab]') {
			if (document.getElementById(ADD_TO_WHITELIST_FRAME_ID) != null)
				document.getElementById(ADD_TO_WHITELIST_FRAME_ID).parentElement.removeChild(document.getElementById(ADD_TO_WHITELIST_FRAME_ID));
			if (document.getElementById(WIZARD_FRAME_ID) != null)
				document.getElementById(WIZARD_FRAME_ID).parentElement.removeChild(document.getElementById(WIZARD_FRAME_ID));

			document.getElementsByTagName('body')[0].style.filter = '';
			window.focus();
		} else if (request.method === '[AutomaticTabCleaner:DrawSetupWizardDialog]') {
			drawSetupWizardDialog();
		}
	});

	function collectVideoTime() {
		if (document.location.href.indexOf('https://www.youtube.com/watch') === 0) {
			const video = document.querySelector('video');
			const time = video ? parseInt(video.currentTime.toFixed(0)) : 0;

			// Update Video Time Url
			const pushState = window.history.pushState;
			const url = new URL(document.location.href);
			url.searchParams.set('t', time + 's');

			pushState.apply(history, [null, document.title, url.href]);

			return time;
		}
	}

	/************************************/
	/*	     DrawSetupWizardDialog      */
	/************************************/


	function drawSetupWizardDialog() {
		if (document.getElementById(WIZARD_FRAME_ID))
			return;

		document.getElementsByTagName('body')[0].style.filter = 'blur(1px)';

		const iframe = document.createElement('iframe');
		iframe.id = WIZARD_FRAME_ID;
		iframe.src = chrome.runtime.getURL('wizard.html?dialog=page&url=' + document.location.href);
		iframe.style.position = 'fixed';
		iframe.style.top = '0px';
		iframe.style.left = '0px';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		//@ts-ignore
		iframe.style.zIndex = 10000000;
		iframe.frameBorder = 'none';
		document.getElementsByTagName('html')[0].appendChild(iframe);
	}

	/************************************/
	/*	   AddPageToWhiteListDialog     */
	/************************************/


	function drawAddPageToWhiteListDialog() {
		if (document.getElementById(ADD_TO_WHITELIST_FRAME_ID))
			return;

		document.getElementsByTagName('body')[0].style.filter = 'blur(1px)';

		const iframe = document.createElement('iframe');
		iframe.id = ADD_TO_WHITELIST_FRAME_ID;
		iframe.src = chrome.runtime.getURL('dialog.html?dialog=page&url=' + document.location.href);
		iframe.style.position = 'fixed';
		iframe.style.top = '0px';
		iframe.style.left = '0px';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		//@ts-ignore
		iframe.style.zIndex = 10000000;
		iframe.frameBorder = 'none';
		document.getElementsByTagName('html')[0].appendChild(iframe); //document.body.appendChild(iframe);
	}

	/************************************/
	/*				FAVICON                   */
	/************************************/
	const lockImgSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAACXBIWXMAAAsSAAALEgHS3X78AAAA70lEQVQYlU3JP2qFMBwA4CQELeSlprwDlE5WeoAsBUHFtVfQ8zxwkQ5d39DF5R3iba2DFQ+h0CwqiX/SX6dCv/VDAICKorjjnL8GQfDped5bVVVHAEAIAFCSJOcsyy5d173keX5J0/QdABBqmuZRSnnVWt/O84yMMQcp5bWu6yfS973gnOuyLClj7Hg6nRwhxDgMg4fDMDy3bfustf7e950QQhBjTPi+/0GVUg8AgIQQAgAwIQSMMVgpdU8ppYu1FrZt2wEAY4zBWosJIQsdx9Gdpom6rvvzl+u60mmabmgURe2yLAfHcdZ/6cRx/PUL8ROEMEM1AFcAAAAASUVORK5CYII=';
	const faviconInfo = getFaviconInfo();
	const links = faviconInfo.domFavicons;
	const img = new Image();

	let originalFaviconUrl;
	let originalCanvas;
	//let currentFaviconUrl;

	let originalIconUrlBase64;

	extractIconBase64();
	window.addEventListener('load', function() {
		setTimeout(extractIconBase64, 1000);
	});

	function getOriginalFaviconUrl() {
		return originalFaviconUrl;
	}

	function genPageFaviconURL() {

		/*		chrome.runtime.sendMessage({
					method: '[AutomaticTabCleaner:getPageFavicon]',
					origin: document.location.origin,
				}, function(response) {
					if (response == null) {
						return;
					}*/

		let url: string;

		try {
			for (let i = 0; i < document.head.children.length; i++) {
				const childElement = document.head.children[i];

				const rel = childElement.getAttribute('rel');

				if (rel != null && rel.indexOf("icon") >= 0) {
					url = childElement.getAttribute('href');
					if (url.indexOf('//') == 0) {
						url = document.location.protocol + url;
					}
					break;
				}

				// Выполнение действий с каждым дочерним элементом
				console.log(childElement.textContent);
			}
		} catch (e) {
			console.log(`Error occurred while extracting icon url from header`, e);
		}

		  const alternativeUrl = new URL(chrome.runtime.getURL("/_favicon/"));
			alternativeUrl.searchParams.set("pageUrl", document.location.origin);
			alternativeUrl.searchParams.set("size", String(ICON_DIMENSION));
			return [url, alternativeUrl.toString()];
		//return 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196';
		//});


	}

	/*function extractIconBase64(faviconUrl, retries)
	{
		const url = faviconUrl ? faviconUrl : faviconInfo.faviconUrl;

		fetch(url,
			{
				method: 'get',
				mode: 'no-cors',
				headers: {'Content-Type':'image/x-icon'}
			})
			//          .then(response => parseResults(response.results))
			.then(response => console.log(response.body))
			.catch(console.error);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', url, true);

		xhr.responseType = 'arraybuffer';

		xhr.onload = function() {
			if (this.status == 200) {
				const uInt8Array = new Uint8Array(this.response);
				let i = uInt8Array.length;
				const binaryString = new Array(i);
				while (i--)
				{
					binaryString[i] = String.fromCharCode(uInt8Array[i]);
				}
				const data = binaryString.join('');

				const base64 = window.btoa(data);

				originalIconUrlBase64 = "data:image/png;base64,"+base64;
				prepareIcon(originalIconUrlBase64);
			}
			else
			if(!retries)
				extractIconBase64(chrome.runtime.getURL('img/new_page.ico') ,1);

		};

		try {
			xhr.send();
		} catch (e) {
			console.debug(e);
		}
	}*/

	function normalizeUrl(url: string): string {
		if (url.indexOf('http') != 0 && url.indexOf('file') != 0 && url.indexOf('chrome') != 0) {
			url = document.location.origin + '/' + url;
		}
		return url;
	}

	function extractIconBase64(faviconUrl?, retries?) {

		if (retries == null) {
			retries = 1;
		}

		if (--retries < 0) {
			return;
		}

		/*if(originalIconUrlBase64 != null) {
			return;
		}*/

		// TODO-v3-old: Try to first get url from header: <link rel="shortcut icon" href="https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196">
		/*const urls: string[] = faviconUrl ? [faviconUrl] : genPageFaviconURL();

		void (async () => {
			for (const i in urls) {
				const url = urls[i];
				if (url == null)
					continue;

				await new Promise<void>(async (resolve, reject) => {
					try {
						if (url.startsWith('data:')) {
							originalIconUrlBase64 = url;
						} else {*/
							chrome.runtime.sendMessage({ method: '[TS:fetchFavicon]'/*, url: normalizeUrl(url)*/ })
								.then(dataUrl => {
									if (dataUrl == null)
										return;
									originalIconUrlBase64 = dataUrl;
									prepareIcon(originalIconUrlBase64);
								})
								.catch((e) => {
									console.error(e);
									extractIconBase64(chrome.runtime.getURL('img/new_page.ico') ,1);
								});
						/*}*/


						/*fetch(url,
							{
								method: 'get',
								//mode: 'no-cors',
								//headers: {'Content-Type':'image/x-icon'}
							})
							//          .then(response => parseResults(response.results))
							.then(async response => {

								const arrayBuffer = null; //await response.arrayBuffer();

								// eslint-disable-next-line @typescript-eslint/no-unused-vars
								const b = await response.blob();

								console.log('Blob', b);

								const base64 = btoa(
									new Uint8Array(await response.arrayBuffer())
										.reduce((data, byte) => data + String.fromCharCode(byte), '')
								);

								console.log('Blob', base64);

								const blob = new Blob([arrayBuffer]);
								const reader = new FileReader();

								reader.onload = (event) => {
									// eslint-disable-next-line @typescript-eslint/no-unused-vars
									const dataUrl = event.target.result;
								};

								reader.readAsDataURL(blob);

								/!*const base64 = btoa(
									new Uint8Array(await response.arrayBuffer())
										.reduce((data, byte) => data + String.fromCharCode(byte), '')
								);*!/

								/!*const uInt8Array = response.body; //new Uint8Array(this.response);
								let i = uInt8Array.length;
								const binaryString = new Array(i);
								while (i--)
								{
									binaryString[i] = String.fromCharCode(uInt8Array[i]);
								}
								const data = binaryString.join('');

								const base64 = window.btoa(data);*!/

								originalIconUrlBase64 = "data:image/png;base64,"+base64;
								prepareIcon(originalIconUrlBase64);

								console.log(response.body);
							})
							.catch(console.error);*/

						/*const img = document.createElement('img');
						document.body.appendChild(img);
						img.crossOrigin="anonymous";
						img.src = url;

						img.onload = () => {
							try {
								const canvas = document.createElement('canvas');
								canvas.width = ICON_DIMENSION;
								canvas.height = ICON_DIMENSION;
								const ctx = canvas.getContext('2d');
								ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
								originalIconUrlBase64 = canvas.toDataURL();
								resolve();
								prepareIcon(originalIconUrlBase64);
							} catch (e) {
								reject(e);
							}
						};

						img.onerror = (error) => {
							reject(error);
							extractIconBase64([chrome.runtime.getURL('img/new_page.ico')], retries-1);
						};*/
						//document.body.appendChild(img);
					/*} catch (e) {
						reject(e);
						extractIconBase64(chrome.runtime.getURL('img/new_page.ico'), retries-1);
					}
				});*/
				/*break;
			}*/
		//})();
	}

	function prepareIcon(iconUrlBase64) {
		if (iconUrlBase64) {
			generateFaviconUri();
			injectFaviconUrl(iconUrlBase64);
		}
	}

	function insertFaviconDomElement() {
		const link = document.createElement('link');
		link.type = 'image/x-icon';
		link.rel = 'shortcut icon';
		document.getElementsByTagName('head')[0].appendChild(link);

		links.push(link);
	}

	function injectFaviconUrl(proccesedIcon) {
		//currentFaviconUrl = proccesedIcon;

		if(links.length === 0){
			insertFaviconDomElement();
		}

		for (let i = 0; i < links.length; i++)
			links[i].href = proccesedIcon;
	}

	function generateFaviconUri() {
		img.crossOrigin = 'anonymous';
		lockImg = new Image();
		lockImg.crossOrigin = 'anonymous';

		img.onload = function() {
			lockImg.src = lockImgSrc;
		};

		lockImg.onload = function() {

			let canvas, ctx;

			if (originalCanvas == null) {
				canvas = window.document.createElement('canvas');
				canvas.width = ICON_DIMENSION;
				canvas.height = ICON_DIMENSION;
				ctx = canvas.getContext('2d');

				ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

				originalCanvas = cloneCanvas(canvas);
			} else {
				canvas = cloneCanvas(originalCanvas);
				ctx = canvas.getContext('2d');
			}

			originalFaviconUrl = canvas.toDataURL();
		};

		img.src = originalIconUrlBase64 || chrome.runtime.getURL('img/new_page.ico');
	}

	function highlite(highliteInfo) {
		if (originalCanvas == null)
			return;

		const canvas = cloneCanvas(originalCanvas);
		const ctx = canvas.getContext('2d');
		_highlite(canvas, ctx, highliteInfo);
	}

	function _highlite(canvas, ctx, highliteInfo) {
		if (highliteInfo != null) {
			if (highliteInfo.lock != null) {
				ctx.globalAlpha = 1;
				ctx.drawImage(lockImg, 9, 7);
			}

			applyPercent(ctx, highliteInfo);
		}

		injectFaviconUrl(canvas.toDataURL());
	}

	/*  Percent  */
	function applyPercent(ctx, highliteInfo) {
		const percent = highliteInfo.suspendPercent;

		ctx.globalAlpha = 1;

		ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, ctx.canvas.width, ctx.canvas.height);

		if(percent) {
			ctx.beginPath();
			ctx.moveTo(0, 62);
			ctx.lineTo(Math.round(64 * percent / 100), 62);
			ctx.strokeStyle = '#1d8cd6';
			ctx.lineWidth = 5;
			ctx.stroke();
		}
	}

	/*************************/

	function cloneCanvas(oldCanvas) {
		const newCanvas = document.createElement('canvas');
		const ctx = newCanvas.getContext('2d');

		newCanvas.width = oldCanvas.width;
		newCanvas.height = oldCanvas.height;

		ctx.drawImage(oldCanvas, 0, 0);

		return newCanvas;
	}

	function getFaviconInfo() {
		const domFavicons = [];
		let faviconUrl = undefined;

		const nodeList = document.getElementsByTagName('link');

		for (let i = 0; i < nodeList.length; i++) {
			if ((nodeList[i].getAttribute('rel') === 'shortcut icon')) {
				faviconUrl = nodeList[i].getAttribute('href');
				domFavicons.push(nodeList[i]);
			}

			if (nodeList[i].getAttribute('rel') === 'icon')
				domFavicons.push(nodeList[i]);
		}

		if (faviconUrl == null)
			if (domFavicons.length > 0)
				faviconUrl = domFavicons[0].getAttribute('href');
			else {
				const url = window.location.href;
				const arr = url.split('/');
				const result = arr[0] + '//' + arr[2] + '/favicon.ico';
				faviconUrl = result;
			}

		return { faviconUrl: faviconUrl, domFavicons: domFavicons };
	}


	function hebernateFormData() {
		let namedDomInputs;
		let domTextareas;
		let namedDomTextareas;
		let domSelects;
		let namedDomSelects;
		let foundOne;
		let foundSelects;
		let foundTexts;
		let j, k, input, name, select, textarea, type, val, len1;

		function isVisible(element) {
			return element.style.display != 'none' && element.style.visibility != 'hidden';
		}

		let actualInputs;
		const inputs = {};
		const domInputs = document.querySelectorAll('input');

		for (let i = 0, len = domInputs.length; i < len; i++) {
			input = domInputs[i];
			if (!isVisible(input))
				continue;
			name = input.name;
			type = input.type;
			if (name in inputs)
				continue;
			actualInputs = {};
			k = 0;
			foundOne = false; // TODO:....
			namedDomInputs = document.querySelectorAll('input[name="' + name + '"]');
			for (let j = 0, len1 = namedDomInputs.length; j < len1; j++) {
				input = namedDomInputs[j];
				++k;
				if (!isVisible(input)) {
					continue;
				}
				switch (type) {
					case 'checkbox':
					case 'radio':
						actualInputs[k] = input.checked ? 'checked' : '';
						if (input.checked)
							foundOne = true;
						break;
					case 'hidden':
						break;
					case 'password':
						break;
					default:
						actualInputs[k] = input.value;
						if (input.value != null && input.value != '')
							foundOne = true;
				}
			}
			if (foundOne)
				inputs[name] = actualInputs;
		}

		const selects = {};
		domSelects = document.querySelectorAll('select');
		for (let i = 0, len = domSelects.length; i < len; i++) {
			select = domSelects[i];
			if (!isVisible(select))
				continue;
			name = select.name;
			if (name in selects)
				continue;
			foundSelects = {};
			k = 0;
			foundOne = false;

			namedDomSelects = document.querySelectorAll('select[name="' + name + '"]');
			for (j = 0, len1 = namedDomSelects.length; j < len1; j++) {
				select = namedDomSelects[j];
				++k;
				if (!isVisible(select))
					continue;
				val = select.options[select.selectedIndex].value;
				foundOne = true;
				if (val instanceof Array)
					foundSelects[k] = val;
				else
					foundSelects[k] = [val];
			}
			if (foundOne)
				selects[name] = foundSelects;
		}

		const texts = {};
		domTextareas = document.querySelectorAll('textarea');
		for (let i = 0, len = domTextareas.length; i < len; i++) {
			textarea = domTextareas[i];
			if (!isVisible(textarea))
				continue;
			name = textarea.name;
			if (name in texts)
				continue;
			foundTexts = {};
			k = 0;
			foundOne = false;
			namedDomTextareas = document.querySelectorAll('textarea[name="' + name + '"]');
			for (j = 0, len1 = namedDomTextareas.length; j < len1; j++) {
				textarea = namedDomTextareas[j];
				++k;
				if (!isVisible(textarea))
					continue;
				foundTexts[k] = textarea.value;
				if (textarea.value != null && textarea.value != '')
					foundOne = true;
			}
			if (foundOne)
				texts[name] = foundTexts;
		}

		const collectedFormData = {
			timestamp: (new Date()).getTime(),
			inputs: inputs,
			texts: texts,
			selects: selects
		};

		if (Object.keys(inputs).length > 0 || Object.keys(texts).length > 0 || Object.keys(selects).length > 0)
			return collectedFormData;
		else
			return null;
	}

	function processRestoreForm(collectedFormData) {
		if (!collectedFormData) {
			return false;
		}
		if (Object.keys(collectedFormData).length === 0 && collectedFormData.constructor === Object) {
			return false;
		}

		const savedData = JSON.parse(collectedFormData);

		for (const name in savedData.inputs) {
			const inputs = document.querySelectorAll('input[name="' + name + '"]');//$('input[name="' + name + '"]');
			let i = 0;
			for (let _i = 0, _len = inputs.length; _i < _len; _i++) {
				const input = inputs[_i];
				++i;
				if (i in savedData.inputs[name]) {
					const val = savedData.inputs[name][i];
					try {
						//@ts-ignore
						switch (input.type) {
							case 'checkbox':
							case 'radio':
								// @ts-ignore
								input.checked = val === 'checked';
								fireEvent(input, 'change');
								break;
							case 'text':
							//case 'password':
							// eslint-disable-next-line no-fallthrough
							case 'date':
							case 'datetime':
							case 'datetime-local':
							case 'email':
							case 'color':
							case 'month':
							case 'number':
							case 'range':
							case 'tel':
							case 'url':
							case 'week':
								//@ts-ignore
								input.value = val;
								fireEvent(input, 'change');
						}
					} catch (e) {
						errorLog(e);
					}
				}
			}
		}

		for (const name in savedData.texts) {
			const savedTexts = savedData.texts[name];
			const texts = document.querySelectorAll('textarea[name="' + name + '"]');
			let i = 0;
			for (let _j = 0, _len1 = texts.length; _j < _len1; _j++) {
				const textarea = texts[_j];
				++i;
				if (i in savedTexts) {
					try {
						//@ts-ignore
						textarea.value = savedTexts[i];
						fireEvent(textarea, 'change');
					} catch (e) {
						errorLog(e);
					}
				}
			}
		}

		const _results = [];
		for (const name in savedData.selects) {
			const savedSelects = savedData.selects[name];
			const selects = document.querySelectorAll('select[name="' + name + '"]');
			let i = 0;
			_results.push((function() {
				let _k, _len2, _results1;

				_results1 = [];
				for (_k = 0, _len2 = selects.length; _k < _len2; _k++) {
					const select = selects[_k];
					++i;
					if (i in savedSelects) {
						try {
							//@ts-ignore
							if (select.value == savedSelects[i])
								continue;
							//@ts-ignore
							select.value = savedSelects[i];
							fireEvent(select, 'change');
						} catch (e) {
							errorLog(e);
						}
						_results1.push();
					} else {
						_results1.push(void 0);
					}
				}
				return _results1;
			})());
		}
	}
})();
