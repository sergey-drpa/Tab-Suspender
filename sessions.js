/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

(function() {
	let pageSize = 30;
	let parkUrl = chrome.extension.getURL('park.html');
	let sessionsUrl = chrome.extension.getURL('sessions.html');
	let scrollYPosition = 0;

	let drawContent = function() {
		return new Promise(function(resolve) {
			chrome.runtime.getBackgroundPage(function(bgpage) {
				chrome.windows.getAll({ 'populate': true }, function(windows) {
					let TSSessionId = bgpage.TSSessionId;
					for (let wi in windows) {
						if (windows.hasOwnProperty(wi)) {
							let tabs = [];
							for (let j in windows[wi].tabs)
								if (windows[wi].tabs.hasOwnProperty(j)) {
									let tab = windows[wi].tabs[j];
									if (tab.url.indexOf(sessionsUrl) == 0)
										continue;
									let parked = tab.url.indexOf(parkUrl) == 0;
									tabs.push({
										title: tab.title,
										url: (parked ? parseUrlParam(tab.url, 'url') : tab.url),
										tabId: (parked ? parseUrlParam(tab.url, 'tabId') : tab.id),
										sessionId: (parked ? parseUrlParam(tab.url, 'sessionId') : TSSessionId),
										nativeTabId: tab.id,
										nativeWindowId: windows[wi].id
									});
									console.log(tab.width);
								}

							let divWindow = document.createElement('div');
							divWindow.classList.add('card');
							divWindow.classList.add('card-window');
							if (parseInt(wi, 10) == 0)
								divWindow.classList.add('first-window');
							divWindow.innerHTML =
								'\t\t<div class="card-header">\n' +
								'\t\t\t<h4 class="my-0 font-weight-normal">Window #' + (parseInt(wi, 10) + 1) + ' <span class="tabs-n">( ' + tabs.length + ' tabs )</span>' + '</h4>\n' +
								'\t\t</div>\n' +
								'\t\t<div id="park' + wi + 'Container" class="container">\n' +
								'\t\t\t<div id="park' + wi + 'Div" class="row">\n' +
								'\t\t\t</div>\n' +
								'\t\t</div>\n';

							document.getElementById('container').appendChild(divWindow);

							new DrawHistory(tabs, 'park' + wi, bgpage, 0, 150);
						}
					}

					resolve();
				});
			});
		});
	};

	drawContent();

	trackErrors('history_page', true);

	setTimeout(function() {
		chrome.extension.onMessage.addListener(function(request) {
			if (request.method == '[AutomaticTabCleaner:updateSessions]') {
				console.log('updateSessions..');
				redraw();
				console.log('updateSessions..Complete.');
			}
		});
	}, 5000);


	function redraw() {
		scrollYPosition = window.scrollY;
		let container = document.getElementById('container');
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}
		drawContent().then(
			function() {
				console.log('scrollYPosition: ', scrollYPosition);
				window.scrollTo({ top: scrollYPosition, behavior: 'instant' });
			});
	}


	function DrawHistory(tabs, targetDiv, bgpage, from, to) {
		this.drawNextPage(tabs, targetDiv, bgpage, from, to);
	}

	DrawHistory.prototype.drawNextPage = function(tabs, targetDiv, bgpage, from, to) {
		this.to = to;
		let self = this;
		if (tabs) {
			for (let i = from; i < to && i < tabs.length; i++) {
				let divLine = drawPreviewTile(tabs[i], bgpage, { noTime: true, close: true });

				(function(i) {
					divLine.getElementsByClassName('card-img-a')[0].onclick = function() {

						chrome.windows.update(tabs[i].nativeWindowId, { focused: true }, function() {
							console.log('window Updated');
							chrome.tabs.update(tabs[i].nativeTabId, { active: true }, function() {
								console.log('tab Updated');
							});
						});
						return false;
					};

					divLine.getElementsByClassName('delete-btn')[0].onclick = function() {
						chrome.tabs.remove(tabs[i].nativeTabId, function() {
							setTimeout(function() {
								redraw();
							}, 150);
						});
					};
				})(i);

				let currentDiv = document.getElementById(targetDiv + 'Div');
				currentDiv.appendChild(divLine);
			}

			if (from == 0 && tabs.length > to) {
				let next = document.createElement('a');
				next.id = targetDiv + '_next_btn';
				next.href = '#';
				next.innerText = 'More History...';
				next.onclick = function() {
					self.drawNextPage(tabs, targetDiv, bgpage, self.to, self.to + pageSize);
					return false;
				};
				document.getElementById(targetDiv + 'Container').appendChild(next);
			}
		}
	};

})();

