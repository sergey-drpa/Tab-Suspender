/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

(function(){
	var pageSize = 30;
	var parkUrl = chrome.extension.getURL('park.html');
	var sessionsUrl = chrome.extension.getURL('sessions.html');
	var scrollYPosition = 0;

	var drawContent = function()
	{
		return new Promise(function(resolve, reject) {
			chrome.runtime.getBackgroundPage(function (bgpage)
			{
				//chrome.extension.sendMessage({method: '[AutomaticTabCleaner:getParkHistory]'}, function (res)
				//{
				chrome.windows.getAll({'populate': true}, function (windows)
				{
					for (var wi in windows)
					{
						if (windows.hasOwnProperty(wi))
						{
							var tabs = [];
							for (var j in windows[wi].tabs)
								if (windows[wi].tabs.hasOwnProperty(j))
								{
									var tab = windows[wi].tabs[j];
									if (tab.url.indexOf(sessionsUrl) == 0)
										continue;
									var parked = tab.url.indexOf(parkUrl) == 0;
									tabs.push({
										title: tab.title,
										url: (parked ? parseUrlParam(tab.url, 'url') : tab.url),
										tabId: (parked ? parseUrlParam(tab.url, 'tabId') : tab.id),
										sessionId: (parked ? parseUrlParam(tab.url, 'sessionId') : bgpage.TSSessionId),
										nativeTabId: tab.id,
										nativeWindowId: windows[wi].id
									});
									console.log(tab.width);
								}

							var divWindow = document.createElement("div");
							divWindow.classList.add("card"); //    margin-top: 70px;
							divWindow.classList.add("card-window");
							if(parseInt(wi, 10) == 0)
								divWindow.classList.add("first-window");
							divWindow.innerHTML =
								//'<div class="card">\n' +
								'\t\t<div class="card-header">\n' +
								'\t\t\t<h4 class="my-0 font-weight-normal">Window #' + (parseInt(wi, 10) + 1) + ' <span class="tabs-n">( ' + tabs.length + ' tabs )</span>' + '</h4>\n' +
								'\t\t</div>\n' +
								'\t\t<div id="park' + wi + 'Container" class="container">\n' +
								'\t\t\t<div id="park' + wi + 'Div" class="row">\n' +
								'\t\t\t</div>\n' +
								'\t\t</div>\n';
							//'\t</div>'

							document.getElementById('container').appendChild(divWindow);

							new DrawHistory(tabs, "park" + wi, bgpage, 0, 150);
						}
					}
					
					resolve();
					//			new DrawHistory(closeHistory, "close", bgpage, 0, 30);
				});
				//});
			});
		});
	};

	drawContent();

	trackErrors('history_page', true);

	setTimeout(function(){
		chrome.extension.onMessage.addListener(function(request, sender, sendResponse)
		{
			if (request.method == "[AutomaticTabCleaner:updateSessions]")
			{
				console.log('updateSessions..');
				redraw();
				console.log('updateSessions..Complete.');
			}
		});
	}, 5000);
	
	
	function redraw() {
		scrollYPosition = window.scrollY;
		var container = document.getElementById('container');
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}
		drawContent().then(
			function(result) { 
				console.log('scrollYPosition: ', scrollYPosition);
				window.scrollTo({top: scrollYPosition, behavior: 'instant'});
			});
	}



	function DrawHistory (closeHistory, targetDiv, bgpage, from, to)
	{
		this.drawNextPage(closeHistory, targetDiv, bgpage, from, to);
	}

	DrawHistory.prototype.drawNextPage = function(closeHistory, targetDiv, bgpage, from, to){
		this.to = to;
		var self = this;
		if (closeHistory)
		{
			for (var i=from;i<to && i<closeHistory.length;i++)
			{
				var divLine = drawPreviewTile(closeHistory[i], bgpage, {noTime: true, close: true});

				(function (i)
				{
					//var cardImgTop = divLine.getElementsByClassName('card-img-top')[0];

					divLine.getElementsByClassName('card-img-a')[0].onclick = function ()
					{
						//cardImgTop.classList.add('clicked');

						chrome.windows.update(closeHistory[i].nativeWindowId, {focused: true}, function ()
						{
							console.log('window Updated');
							chrome.tabs.update(closeHistory[i].nativeTabId, {active: true}, function ()
							{
								console.log('tab Updated')
								//cardImgTop.classList.remove('clicked');
							})
						});
						return false;
					};
					
					divLine.getElementsByClassName('delete-btn')[0].onclick = function () {
						chrome.tabs.remove(closeHistory[i].nativeTabId, function () {
							setTimeout(function(){
								redraw();
							}, 150);
						});
					};
				})(i);

				var currentDiv = document.getElementById(targetDiv+'Div');
				currentDiv.appendChild(divLine);
			}

			if(from == 0 && closeHistory.length > to){
				var next =  document.createElement("a");
				next.id = targetDiv+'_next_btn';
				next.href = "#";
				next.innerText = 'More History...';
				next.onclick = function () {
					self.drawNextPage (closeHistory, targetDiv, bgpage, self.to, self.to+pageSize);
					return false;
				};
				document.getElementById(targetDiv+'Container').appendChild(next);
			}
		}
	}

})();

