/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

(function() {
	'use strict';

	window.focus();
	let overlay = document.querySelector('.overlay');

	let baseUrl = parseUrlParam('url');
	/* let dialogMode = parseUrlParam('dialog'); */
	let separateTab = parseUrlParam('separate_tab');
	let requesterTabId = parseUrlParam('requester_tab_id');

	if (separateTab == 'true')
		overlay.classList.add('separateTab');

	let closeSeparateTab;

	function closeDialog() {
		chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:hideDialog]' }, closeSeparateTab = function(response) {
			if (separateTab == 'true') {
				chrome.tabs.update(parseInt(requesterTabId), { active: true });
				chrome.tabs.remove(response.tabId);
			}
		});
	}

	if (separateTab != 'true')
		overlay.addEventListener('click', closeDialog);

	document.querySelector('#cancelButton').addEventListener('click', closeDialog);

	let addWhitelistHandler;
	document.getElementById('addButton').addEventListener('click', addWhitelistHandler = function() {
		chrome.runtime.sendMessage({
			method: '[AutomaticTabCleaner:addToWhiteList]',
			hideDialog: true,
			pattern: constructUrl({ 'final': true })
		}, closeSeparateTab);
	});

	document.onkeydown = function(evt) {
		evt = evt || window.event;
		if (evt.keyCode == 27) {
			closeDialog();
		} else if (evt.keyCode == 13)
			addWhitelistHandler();
	};

	document.getElementById('pattern').value = baseUrl;

	let parser = document.createElement('a');
	parser.href = baseUrl;

	let subDomains = parser.host.split('.');
	let subPaths = [];
	let pathname = parser.pathname;
	if (pathname.length > 0) {
		if (pathname.substr(0, 1) == '/')
			pathname = pathname.substr(1);
		if (pathname.length > 1 && pathname.substr(pathname.length - 1) == '/')
			pathname = pathname.substr(0, pathname.length - 1);
	}
	if (pathname != '' && pathname != '/')
		subPaths = pathname.split('/');

	let siteSlider = document.getElementById('siteSlider');
	let pageSlider = document.getElementById('pageSlider');

	document.getElementById('pattern').value = constructUrl();//"*"+subDomains.join('.')+(subPaths.length>0?"/":"")+subPaths.join("/")+"/*";

	if (subDomains.length >= 3) {
		siteSlider.style.display = '';
		siteSlider.max = subDomains.length - 2;
		siteSlider.addEventListener('input', function(arg) {
			console.log(this.value, this, arg);
			document.getElementById('pattern').value = constructUrl();
		});
	} else {
		siteSlider.style.display = 'none';
		document.getElementById('siteSliderSpan').style.display = 'none';
	}


	if (subPaths.length > 0) {
		pageSlider.style.display = '';
		pageSlider.max = subPaths.length;
		pageSlider.value = 0;
		pageSlider.addEventListener('input', function(arg) {
			console.log(this.value, this, arg);
			document.getElementById('pattern').value = constructUrl();
		});
	} else {
		pageSlider.style.display = 'none';
		document.getElementById('pageSliderSpan').style.display = 'none';
	}

	function constructUrl(options) {
		'use strict';

		let domain;
		if (subDomains.length > 2) {
			let subSubDomains = subDomains.slice(siteSlider.value/*,subDomains.length-1*/);
			domain = subSubDomains.join('.');
		} else
			domain = subDomains.join('.');

		let path;
		if (subPaths.length > 0) {
			if (subPaths != null) {
				let subSubPath = subPaths.slice(0, pageSlider.value);
				path = subSubPath.join('/');
			} else
				path = '/';
		} else
			path = subPaths.join('/');

		return '*' + domain + (path ? '/' : '') + path + (!options || options['final'] == false ? '/' : '') + '*';
	}

	/************************/
	/*		Util Methods    */
	/************************/

	function parseUrlParam(val) {
		'use strict';

		let tmp = [];
		let parts = window.location.search.substr(1).split('&');

		for (let i = 0; i < parts.length; i++) {
			tmp = parts[i].split('=');
			if (tmp[0] === val)
				return decodeURIComponent(tmp[1]);
		}
	}
})();
