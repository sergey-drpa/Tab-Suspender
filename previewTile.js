'use strict';

// eslint-disable-next-line no-redeclare,no-unused-vars
function drawPreviewTile(tile, bgpage, options) {
	let emptyScreen = '/img/no_preview_available.png';
	let chromeStore = '/img/Chrome-Store-Logo.png';
	let extension = '/img/Chrome-Extension.jpg';
	let divLine = document.createElement('div');
	divLine.classList.add('mx-auto');
	divLine.innerHTML =
		'<div class="card" style="width: 22rem;">\n' +
		'<a href="' + tile.url + '" target="_blank" class="card-img-a">' +
		'  <img class="card-img-top" style="max-height: 11.6rem; min-height: 11.6rem;">\n' +
		'</a>' +
		'  <div class="card-body" style="overflow: hidden;">\n' +
		(options && options.close ? '	<img src="/img/Close_Icon_24.png" class="delete-btn" title="Close Tab">' : '') +
		'    <h5 class="card-title">' +
		'<a href="' + tile.url + '" target="_blank" nativeTabId="' + tile.nativeTabId + '">' + (tile.title ? tile.title : parseUrlParam(tile.url, 'title')) + '</a>' +
		'</h5>\n' +
		'    <p class="card-text" style="white-space: nowrap; color: #999; margin-bottom: .25rem !important; text-overflow: ellipsis; overflow: hidden; font-size: 11px;">' +
		'<a href="' + tile.url + '" target="_blank" style="color: #999;">' + tile.url + '</a>' +
		'</p>\n' +
		(options && options.noTime ? '' : '<p class="card-text" style="font-size: 9px; color: #999;">' + timeConverter(tile.timestamp) + '</p>\n') +
		'  </div>\n' +
		'</div>';

	let img = divLine.getElementsByTagName('img')[0];

	let tmpF = function(imgElement) {
		let timeoutId;
		$(imgElement).hover(function() {
				if (imgElement.src.indexOf('chrome-extension://') == 0)
					return;

				if (!timeoutId) {
					timeoutId = window.setTimeout(function() {
						timeoutId = null; // EDIT: added this line

						if (!imgElement.classList.contains('clicked'))
							imgElement.classList.add('zoom');
					}, 1000);
				}
			},
			function() {
				if (timeoutId) {
					window.clearTimeout(timeoutId);
					timeoutId = null;
				} else {
					imgElement.classList.remove('zoom');
				}
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
