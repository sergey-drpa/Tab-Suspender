/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

(function() {
	let pageSize = 30;

	chrome.runtime.getBackgroundPage(function(bgpage) {
		chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:getParkHistory]' }, function(res) {

			let parkHistory = res.parkHistory;
			let closeHistory = res.closeHistory;

			new DrawHistory(parkHistory, 'park', bgpage, 0, 30);

			new DrawHistory(closeHistory, 'close', bgpage, 0, 30);

			trackErrors('history_page', true);
		});
	});

	function DrawHistory(closeHistory, targetDiv, bgpage, from, to) {
		this.drawNextPage(closeHistory, targetDiv, bgpage, from, to);
	}

	DrawHistory.prototype.drawNextPage = function(closeHistory, targetDiv, bgpage, from, to) {
		this.to = to;
		let self = this;
		if (closeHistory) {
			for (let i = from; i < to && i < closeHistory.length; i++) {
				let divLine = drawPreviewTile(closeHistory[i], bgpage);

				let currentDiv = document.getElementById(targetDiv + 'Div');
				currentDiv.appendChild(divLine);
			}

			if (from == 0 && closeHistory.length > to) {
				let next = document.createElement('a');
				next.id = targetDiv + '_next_btn';
				next.href = '#';
				next.innerText = 'More History...';
				next.onclick = function() {
					self.drawNextPage(closeHistory, targetDiv, bgpage, self.to, self.to + pageSize);
					return false;
				};
				document.getElementById(targetDiv + 'Container').appendChild(next);
			}
		}
	};
})();
