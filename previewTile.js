"use strict";

function drawPreviewTile(tile, bgpage, options)
{
    var emptyScreen = '/img/no_preview_available.png';
	var chromeStore = '/img/Chrome-Store-Logo.png';
	var extension = '/img/Chrome-Extension.jpg';
    var divLine = document.createElement("div");
    divLine.classList.add("mx-auto");
    divLine.innerHTML =
        '<div class="card" style="width: 22rem;">\n' +
        '<a href="' + tile.url + '" target="_blank" class="card-img-a">' +
        '  <img class="card-img-top" style="max-height: 11.6rem; min-height: 11.6rem;">\n' +
        '</a>' +
        '  <div class="card-body" style="overflow: hidden;">\n' +
		(options.close ? '	<img src="/img/Close_Icon_24.png" class="delete-btn" title="Close Tab">' : '') +
        '    <h5 class="card-title">' +
        '<a href="' + tile.url + '" target="_blank" nativeTabId="'+tile.nativeTabId+'">' +(tile.title ? tile.title : parseUrlParam(tile.url, 'title')) + '</a>' +
        '</h5>\n' +
        '    <p class="card-text" style="white-space: nowrap; color: #999; margin-bottom: .25rem !important; text-overflow: ellipsis; overflow: hidden; font-size: 11px;">' +
        '<a href="' + tile.url + '" target="_blank" style="color: #999;">' + tile.url + '</a>' +
        '</p>\n' +
        (options && options.noTime ? '' : '<p class="card-text" style="font-size: 9px; color: #999;">' + timeConverter(tile.timestamp) + '</p>\n') +
        //'    <a href="#" class="btn btn-primary">Go somewhere</a>\n' +
        '  </div>\n' +
        '</div>';

    var img = divLine.getElementsByTagName('img')[0];

    var tmpF = function (imgElement)
    {
        var timeoutId;
        $(imgElement).hover(function ()
            {
                if (imgElement.src.indexOf('chrome-extension://') == 0)
                    return;

                if (!timeoutId)
                {
                    timeoutId = window.setTimeout(function ()
                    {
                        timeoutId = null; // EDIT: added this line

                        if(!imgElement.classList.contains('clicked'))
                            imgElement.classList.add('zoom');
                    }, 1000);
                }
            },
            function ()
            {
                if (timeoutId)
                {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                } else
                {
                    imgElement.classList.remove('zoom');
                }
            });

        if (tile.tabId != null && tile.sessionId != null)
        {

            bgpage.getScreen(tile.tabId, tile.sessionId, function (scr, pixRat)
            {
                if (scr != null)
                    imgElement.src = scr;
                else if(tile.url.indexOf('https://chrome.google.com/webstore') == 0)
					imgElement.src = chromeStore;
				else if(tile.url.indexOf('chrome://extensions') == 0 || tile.url.indexOf('chrome-extension://') == 0)
					imgElement.src = extension;
				else
                    imgElement.src = emptyScreen;
            });
        } else
        {
            imgElement.src = emptyScreen;
        }

    };
    tmpF(img);

    return divLine;
}

function timeConverter(UNIX_timestamp){
    var a = new Date(UNIX_timestamp);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var year = a.getFullYear();
    var month = months[a.getMonth()];
    var date = a.getDate();
    var hour = a.getHours();
    var min = a.getMinutes();
    var sec = a.getSeconds();

    month = (month < 10 ? "0" : "") + month;
    date = (date < 10 ? "0" : "") + date;
    hour = (hour < 10 ? "0" : "") + hour;
    min = (min < 10 ? "0" : "") + min;
    sec = (sec < 10 ? "0" : "") + sec;

    var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
    return time;
}
