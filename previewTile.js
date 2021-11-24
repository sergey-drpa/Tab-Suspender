'use strict';

const extensionUrl = chrome.extension.getURL('');

// eslint-disable-next-line no-redeclare,no-unused-vars
function drawPreviewTile(tile, bgpage, options) {
	let emptyScreen = '/img/no_preview_available.png';
	let chromeStore = '/img/Chrome-Store-Logo.png';
	let extension = '/img/Chrome-Extension.jpg';
	let divLine = document.createElement('div');
	divLine.classList.add('mx-auto');
	divLine.innerHTML =
		'<div class="card">\n' +
		'<a ' + (!options || !options.noHref ? 'href="' + tile.url + '"' : '') + ' target="_blank" class="card-img-a">' +
		'  <img class="card-img-top">\n' +
		'</a>' +
		'  <div class="card-body">\n' +
		(options && options.close ? '	<img src="/img/Close_Icon_24.png" class="delete-btn" title="Close Tab">' : '') +
		(!options || !options.noTitle ? '    <h5 class="card-title">' + '<a href="' + tile.url + '" target="_blank" nativeTabId="' + tile.nativeTabId + '">' + (tile.title ? tile.title : parseUrlParam(tile.url, 'title')) + '</a>' +
			'</h5>\n' : '') +
		(!options || !options.noUrl ? '<p class="card-text">' +
		'<a href="' + tile.url + '" target="_blank" style="color: #999;">' + (tile.url.indexOf(extensionUrl) === 0 ? new URLSearchParams(tile.url).get('url') : tile.url) + '</a>' +
		'</p>\n':'') +
		(options && options.noTime ? '' : '<p class="card-text time">' + timeConverter(tile.timestamp) + '</p>\n') +
		'  </div>\n' +
		'</div>';

	let img = divLine.getElementsByTagName('img')[0];

	let tmpF = function(imgElement) {
		let timeoutId;

		$(imgElement).hover(function() {
				//if (imgElement.src.indexOf('chrome-extension://') == 0)
				//	return;

				if (!timeoutId) {
					timeoutId = window.setTimeout(function() {
						timeoutId = null; // EDIT: added this line

						if (!imgElement.classList.contains('clicked'))
							imgElement.classList.add('zoom');

					}, 1000);

					$('.card-img-top').each((_, imgDomElement) => {
						if (imgDomElement !== imgElement) {
							if (imgDomElement.classList.contains('zoom')) {
								imgDomElement.classList.remove('zoom');
								imgDomElement.removeAttribute('style');
							}
						}
					});
				}
			},
			function() {
				if (timeoutId) {
					window.clearTimeout(timeoutId);
					timeoutId = null;
				} else {
					//imgElement.classList.remove('zoom');
				}
				imgElement.classList.remove('zoom');
				imgElement.removeAttribute('style');
			});

		if (tile.tabId != null && tile.sessionId != null) {

			bgpage.getScreen(tile.tabId, tile.sessionId, function(scr) {
				if (scr != null)
					imgElement.src = scr;
				else if (tile.url.indexOf('https://chrome.google.com/webstore') == 0)
					imgElement.src = chromeStore;
				else if (tile.url.indexOf('chrome://extensions') == 0 || tile.url.indexOf('chrome-extension://') == 0)
					imgElement.src = extension;
				else
					imgElement.src = emptyScreen;
			});
		} else {
			imgElement.src = emptyScreen;
		}

	};
	tmpF(img);

	return divLine;
}

function timeConverter(UNIX_timestamp) {
	let a = new Date(UNIX_timestamp);
	let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	let year = a.getFullYear();
	let month = months[a.getMonth()];
	let date = a.getDate();
	let hour = a.getHours();
	let min = a.getMinutes();
	let sec = a.getSeconds();

	month = (month < 10 ? '0' : '') + month;
	date = (date < 10 ? '0' : '') + date;
	hour = (hour < 10 ? '0' : '') + hour;
	min = (min < 10 ? '0' : '') + min;
	sec = (sec < 10 ? '0' : '') + sec;

	let time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec;
	return time;
}
