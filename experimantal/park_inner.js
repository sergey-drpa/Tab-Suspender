/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

var bgpage = window;
 
function park_inner(window, document, console, isLoaded)
{
	"use strict";



	var debug = true;
	var debugPerformance = true;

	if(debugPerformance)
    {
        console.log("Compiled inside: ", Date.now());
        console.time("Load time...");
    }

    var urlParamChache = {};
	var backProcessed = false;
	var title;
	var favicon;
	var link;
	var ir="ifr";
	var secondTime = false;
	var restoreEvent = 'hover';
	var reloadTabOnRestore = false;
    var tabId;
    var targetUrl;
	var am="ame";
    //var loaded = false;
    var bgScreen = null; /* TEMPORARLY VARDON'T FORGGOT TO CLEAN AFTER DRAW! */
    var isTabMarkedForUnsuspend = false;
    var parkedUrl;
	var html="html";

	//window.completeLoadedPromise = new Promise(function(resolve, reject){
        /*window.addEventListener('load', function ()
        {
            if (debugPerformance)
                console.log("onload: ", Date.now());
            loaded = true;
    //        resolve();
        });*/
    //}

    /*(function()
    {
        console.log("getBackgroundPage: ", Date.now());
        window.bgpage = chrome.extension.getBackgroundPage();
        console.log("getBackgroundPage Loaded: ", Date.now());*/

		/*window.domLoadedPromise = new Promise(function(resolve, reject)
        {
            document.addEventListener('DOMContentLoaded', function ()
            {
                if(debugPerformance)
                	console.log("onDOMContentLoaded: ", Date.now());
        */        
                try
                {
                    createTitleAndIcon();
					applysUserDisplayHeight(window.innerHeight);
                }
                catch (e)
                {
                }

        /*        resolve();
            }, true);
        });*/

			if(debugPerformance)
            	console.log("getBackgroundPage: ", Date.now());
			
			try 
			{
				//throw "Error";
				//chrome.runtime.getBackgroundPage(function(bgpage)
				{
					if(debugPerformance)
						console.log("getBackgroundPage Loaded: ", Date.now());

					//window.domLoadedPromise.then(function(){

						try
						{
							var isStartDiscarted = bgpage.getStartDiscarted();

							console.log("bgpage.getStartDiscarted(): ",isStartDiscarted);

							tabId = parseUrlParam('tabId');
							
							//throw "Error";

							if (isStartDiscarted == true)
							{
								if ((Date.now() - bgpage.getStartedAt()) < 15000)
								{
									console.log("(new Date().getTime() - bgpage.getStartedAt()) < 15000: ",(Date.now() - bgpage.getStartedAt()) < 15000);
									if (bgpage.isFirstTimeTabDiscard(tabId))
									{
										console.log("bgpage.isFirstTimeTabDiscard(tabId): ",bgpage.isFirstTimeTabDiscard(tabId));
										chrome.tabs.getCurrent(function (tab) {
											if (tab.active == false) {
												console.log("tab.active: ",tab.active);
												//window.completeLoadedPromise.then(function(){
												//setTimeout(function(){
													window.stop();
													chrome.runtime.sendMessage({'method': "[AutomaticTabCleaner:DiscardTab]"});
												//}, 3000);
												
												//continueCheck();
												return;
											}
											else
												continueCheck();
										});
									}
									else
										continueCheck();
								}
								else
									continueCheck();
							}
							else
								continueCheck();
						}
						catch (e)
						{
							console.error(e);
							
							//window.domLoadedPromise.then(function(){
								applyRestoreButtonView();
								setTimeout(drawContent, 0);
								setTimeout(continueStart, 0);
							//});
						}

						/* CHECK IF TAB MARKED FOR UNSUSPEND */
						function continueCheck ()
						{
							if(debugPerformance)
								console.log("Continue Chaeck: ", Date.now());

                            chrome.tabs.getCurrent(function (tab){
                            	parkedUrl = bgpage.getTabInfo(tab).parkedUrl;
                            });

							//throw "Error2";

							isTabMarkedForUnsuspend = bgpage.isTabMarkedForUnsuspend(tabId, parseUrlParam('sessionId'), {'remove' : true});
							if (debug)
								console.log("isTabMarkedForUnsuspend: ", isTabMarkedForUnsuspend);

							if (isTabMarkedForUnsuspend)
							{
								document.getElementById('resoteImg').style.display = "none";
								document.getElementById('topRestore').style.display = "none";
								reloadTabOnRestore = bgpage.getReloadTabOnRestore();
								setTimeout(continueStart, 0);
							}
							else
							{
								if(debugPerformance)
									console.log("Get Screen: ", Date.now());
								bgpage.getScreen(tabId, parseUrlParam('sessionId'), function(scr)
								{
									try
									{
										if(debugPerformance)
											console.log("Get Screen Loaded: ", Date.now());
										
										//throw "Error";
										
										bgScreen = scr;
										/* EXPERIMANTAL */
										setTimeout(drawContent, 0);
										setTimeout(continueStart, 0);
									}
									catch (e)
									{
										console.error(e);
										
										//window.domLoadedPromise.then(function(){
											applyRestoreButtonView();
											setTimeout(drawContent, 0);
											setTimeout(continueStart, 0);
										//});
									}
								});

								if(debugPerformance)
									console.log("Apply background: ", Date.now());
									
								applysSreenshotCssStyle(bgpage.getScreenshotCssStyle());
								applyBackground("#"+bgpage.getParkBgColor());
								applyRestoreButtonView(bgpage.getRestoreButtonView());
								restoreEvent = bgpage.getRestoreEvent();
								reloadTabOnRestore = bgpage.getReloadTabOnRestore();
							}
						}
					//});

					//window.domLoadedPromise = null;
				}
				//)
				;
			}
			catch (e)
			{
				console.error(e);
				
				//window.domLoadedPromise.then(function(){
					applyRestoreButtonView();
					setTimeout(drawContent, 0);
					setTimeout(continueStart, 0);
				//});
			}

        //}, true);
    //})();

	function applysUserDisplayHeight(height)
	{
		var resoteImg=document.getElementById('resoteImg');
		
		console.log('DisplayHeight: ', height);
		if(height != null)
		{
			if(height <= 600)
			{
				resoteImg.width = '128';
				resoteImg.height = '128';
				resoteImg.classList.add('h600');
			}
			else if(height <= 1024)
			{
				resoteImg.width = '196';
				resoteImg.height = '196';
				resoteImg.classList.add('h1024');
			}
		}
		
		resoteImg.classList.remove('wait-for-render');
	}
	
    function applyRestoreButtonView(restoreButtonView)
	{
		var screen = document.getElementById('screen');
		var resroreImg = document.getElementById('resoteImg');
		
		var initOriginalUrlBlock = function() {
			/* Native Url Block */
			document.body.classList.add("always-visible");
			document.getElementById("nativeUrlSpan").onclick = document.getElementById("nativeUrl").onclick = function() {
				window.getSelection().selectAllChildren(document.getElementById("nativeUrlSpan"));
			};
		}
		
        if(restoreButtonView == null || restoreButtonView == 'roundIcon')
        {
            resroreImg.style.display = "block";
            document.getElementById('topRestore').style.display = "none";
			
			initOriginalUrlBlock();

            resroreImg.onmouseover = function(){
                if(restoreEvent == 'hover')
                {
                    goBack();
                    resroreImg.className = "restore inprogress";
					screen.classList.add("inprogress");
                }
            };

            resroreImg.onclick =  function(){
                if(restoreEvent == 'click')
                {
                    goBack();
                    resroreImg.className = "restore inprogress";
					screen.classList.add("inprogress");
                }
            };
        }
        else if(restoreButtonView == 'topBar')
		{
            resroreImg.style.display = "none";
            document.getElementById('topRestore').style.display = "block";

            document.getElementById('topRestore').onclick =  function(){
                /*if(restoreEvent == 'click')
                {*/                	
                    goBack();
					document.getElementById('topRestore').className = "topRestore inprogress";
					screen.classList.add("inprogress");
                //}
            };
        }
		else if(restoreButtonView == 'noIcon')
		{
			resroreImg.style.display = "none";
			document.getElementById('topRestore').style.display = "none";
			
			initOriginalUrlBlock();
		}
		
		document.getElementById('screenDiv').onclick = function(){
			goBack();
			resroreImg.className = "restore inprogress";
			screen.classList.add("inprogress");
        };
	}

	function applyBackground(color)
	{
		document.body.style.background = color;
	}

	function applysSreenshotCssStyle(cssText)
	{
		document.getElementById('screen').style.cssText = cssText;
	}

	function createTitleAndIcon() {

		if(title==null)
			title = parseUrlParam('title');
		if(document.title != title)
			document.title = title;

		link = document.getElementById('faviconLink');

		if(link != null)
			if(link.href != null && link.href.indexOf('img/icon16_off.png') == -1)
				return;

		if(link == null)
		{
			link = document.createElement('link');
			link.type = 'image/x-icon';
			link.rel = 'shortcut icon';
		}

		if(favicon == null)
			generateFaviconUri(parseUrlParam('icon', false), function (proccesedIcon) {
				favicon = proccesedIcon;
				link.href = proccesedIcon;
				if(link.id != 'faviconLink')
					document.getElementsByTagName('head')[0].appendChild(link);
			});

		if(favicon != null)
			link.href = favicon;
	}

	function parseUrlParam(name, doNotCache) {
		var val;
		if((val=urlParamChache[name]) != null)
			return val;

		var tmp = [];
		var parts = window.location.search.substr(1).split("&");

		for(var i =0; i<parts.length;i++){
			tmp = parts[i].split("=");
			if (tmp[0] === name)
            {
            	if(doNotCache === true)
                    return decodeURIComponent(tmp[1]);
            	else
                	return urlParamChache[name] = decodeURIComponent(tmp[1]);
            }
		}
	}

	function generateFaviconUri(url, callback) {

		var img = new Image();
		img.onload = function () {
			var canvas,
				context;
			canvas = window.document.createElement("canvas");
			canvas.width = img.width;
			canvas.height = img.height;
			context = canvas.getContext("2d");
			context.globalAlpha = 0.4;
			context.drawImage(img, 0, 0);
			callback(canvas.toDataURL());
		};
		img.src = url && url != 'undefined' ? url : chrome.extension.getURL('img/new_page.ico');
	}
	
	function drawContent()
	{
        if(debugPerformance)
        	console.log("Drow Content: ", Date.now());
        createTitleAndIcon();
        var screenImg = document.getElementById('screen');

        try
        {
            if (window.devicePixelRatio > 1)
                screenImg.style.transform = 'scale(' + 1 / window.devicePixelRatio + ', ' + 1 / window.devicePixelRatio + ')';
        }
        catch (e)
        {
            console.error(e);
        }

        if(bgScreen == null)
        {
            screenImg.style.display = "none";
            document.getElementById('title').innerHTML = title;
            document.getElementById('title').href = parseUrlParam('url');
            document.getElementById('favicon').src = favicon;
            document.getElementById('title_div').style.display = "block";
            document.getElementById('nativeUrl').classList.add("visible");
        }
        else
            screenImg.src = bgScreen;
			
		/* TODO: add dynamic restoreImg resize */

        bgScreen = null;
        favicon = null;

        if(debugPerformance)
        {
            console.log("Complete!!!: ", Date.now());
            console.timeEnd("Load time...");
        }
	}

    function continueStart ()
	{
        if (isTabMarkedForUnsuspend)
        {
            //window.stop();
            if (debug)
                console.log("Prepare to go Back!");

            goBack({force: true});

            return;
        }

        /****
		 * TODO: Looks like document.readyState === "complete" != window.addEventListener('load'
         */
        if (isLoaded())//document.readyState === "complete"
        {
        	console.log("Page Already loaded");
            startEX();
        }
        else
        {
            console.log("Waiting for Page load...", Date.now());
			setTimeout(continueStart, 50);
				//window.addEventListener('load', startEX);
        }
        //setTimeout(startEX, 100);
    }

	function startEX () 
	{
         if(debugPerformance)
		 	console.log("Start begun...!", Date.now());
		
		//createTitleAndIcon();
		
				/*var screenImg = document.getElementById('screen');
				if(screen == null)
				{
					screenImg.style.display = "none";
					document.getElementById('title').innerHTML = title;
					document.getElementById('favicon').src = favicon;
					document.getElementById('title_div').style.display = "block";
				}
				else
					screenImg.src = screen;

                screen = null;*/
				favicon = null;
            /*});


		});*/

		//window.bgpage = null;
		
		chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
			
			if(message.method == "[AutomaticTabCleaner:RestoreMessage]")
			{				
				if(message.anyWay)
					goBack();
				else
					chrome.tabs.getCurrent(function (tab){
						if(message.tab.id == tab.id)
							goBack();
					});
			}
			else if(message.method == "[AutomaticTabCleaner:UpdateTabsSettings]")
			{				
				if(message.restoreEvent != null)
					restoreEvent = message.restoreEvent;
					
				if(message.reloadTabOnRestore != null)
					reloadTabOnRestore = message.reloadTabOnRestore;
					
				if(message.parkBgColor != null)
					applyBackground("#"+message.parkBgColor);

				if(message.screenshotCssStyle != null)
					applysSreenshotCssStyle(message.screenshotCssStyle);

                if(message.restoreButtonView != null)
                    applyRestoreButtonView(message.restoreButtonView);
			}
			else if(message.method == "[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]")
			{
				drawAddPageToWhiteListDialog();
			}
			else if (message.method === "[AutomaticTabCleaner:hideDialogRequetToTab]")
			{
				//console.log("called");
				document.getElementById("ATCSDialogiFrame").parentElement.removeChild(document.getElementById("ATCSDialogiFrame"));
				document.getElementById("screen").style.filter = '';
				window.focus();
				
				if(message.options && message.options.goBack)
					goBack();
				else
					showNativeUrl();
			}
		});
				
		secondTime = isSecondTime();
		
		document.getElementById('title').onclick = 
		document.getElementById('titleImg').onclick = function () {
			goBack();
			return false;
		};

		/*if(!secondTime)
		{
			window.location.href = window.location.href + "#secondTime";
		}*/
        var url = parseUrlParam('url');

		if(url.indexOf('http://') == 0)
			url = url.substr(7);
		if(url.indexOf('https://') == 0)
			url = url.substr(8);
		
		document.getElementById('nativeUrlSpan').innerText = url;
		
		initNativeUrlAnimation ();
		
		/*setTimeout(function() {
			var parki = document.createElement('iframe'); // to isolate User Data from Analitics
			parki.src="parki."+html;
			document.getElementsByTagName("body")[0].appendChild(parki);
			setTimeout(function() {document.getElementsByTagName("body")[0].removeChild(document.getElementsByTagName('iframe')[0]);}, 5000);}, getRandomInt(20, 60)*1000);*/
	}
	
	function getRandomInt(min, max) {
		return Math.floor(Math.random() * (max - min)) + min;
	}

	function goBack(options) {

        chrome.runtime.sendMessage({'method':"[AutomaticTabCleaner:TabUnsuspended]", 'targetTabId': tabId, 'url': targetUrl});

		if(!backProcessed || options != null && options.force == true)
		{
			if(reloadTabOnRestore == false &&
				!isFromHistory() &&
                parkedUrl != null
				/* TODO: Rework this logic && window.history.length > 2 && !secondTime*/) {
				if(debug)
					console.log('Back');
                //window.history.go(-1);
                //window.history.back();
				//setTimeout(function(){}, 1500);
				historyFallback(parseUrlParam('url'));
				//alert('History');
			}
			else
			{
				if(debug)
					console.log('Reload');
				//window.location.href = targetUrl;
                window.location.replace(parseUrlParam('url'));
                //alert('Link');
			}
		}
		backProcessed = true;
	}
	
	function historyFallback(fallbackUrl) 
	{
		var hasHistory = false;
		var prevPage = window.location.href;

		window.onbeforeunload = function(e) {
			hasHistory = true;
		};

        /*setInterval(function(){
            console.log(location.href);
        }, 0);*/
		window.history.go(-1);

		setInterval(function(){ 
			console.log('hasHistory: '+hasHistory);
		}, 100);
		
		setTimeout(function(){ 
			if(hasHistory != true)
			{
				window.location.assign(fallbackUrl); 
				if(debug)
					console.log('Force Back 500ms!!!');
			}
		}, 500);
		
		/*setTimeout(function(){
			if (window.location.href == prevPage) 
			{
				window.location.assign(fallbackUrl); 
				if(debug)
					console.log('Force Back!!! 750ms');
			}
		}, 1500);*/
	}

	window.startEX = startEX;


	
	function isSecondTime()
	{
		var indexOfNumberSymbol = window.location.href.lastIndexOf("#");
		if(indexOfNumberSymbol != -1)
			if(location.href.substring(indexOfNumberSymbol) == "#secondTime")
				return true;
		return false;
	}

    function isFromHistory()
    {
        var indexOfNumberSymbol = window.location.href.lastIndexOf("#");
        if(indexOfNumberSymbol != -1)
            if(location.href.substring(indexOfNumberSymbol) == "#fromHistory")
                return true;
        return false;
    }

	var nativeUrlVisible = false;
	var nativeUrlTimer = null;
	var nativeUrlTimerClose = null;
	var nativeUrlTimerCloseAfterTimeout = null;
	var nativeUrlPosition;
	var nativeUrlElement = document.getElementById("nativeUrl");
	var nativeUrlElementHover = false;


	var showNativeUrl;
	var hideNativeUrl;
	function initNativeUrlAnimation ()
	{
		
		if(nativeUrlElement != null)
			return;
			
		var nativeUrlElement = document.getElementById("nativeUrl");
		
		if(nativeUrlElement == null)
			return;
		
		
		nativeUrlElement.onmouseover = function (){
			nativeUrlElementHover = true;
			if(nativeUrlTimerCloseAfterTimeout)
				clearTimeout(nativeUrlTimerCloseAfterTimeout);			
		};
		
		nativeUrlElement.onmouseout = function (event){
			if(event)
			{
				var e = event.toElement || event.relatedTarget;
				if(e)
				{
					if ((e.parentNode == this || (e.parentNode != null && e.parentNode.parentNode == this) || e == this))
						return;
				}
			}
		
			nativeUrlElementHover = false;
			if(nativeUrlTimerCloseAfterTimeout)
				clearTimeout(nativeUrlTimerCloseAfterTimeout);

			nativeUrlTimerCloseAfterTimeout = setTimeout(function() {
				hideNativeUrl();
			}, 5000);
		};
		
		
		hideNativeUrl = function (){
			if(nativeUrlVisible != true)
				return;
			
			nativeUrlTimer = null;
						
			nativeUrlTimerClose = setInterval(function (){
				nativeUrlElement.style.top = --nativeUrlPosition + "px";
				if(nativeUrlPosition <= -27)
				{
					nativeUrlVisible = false;
					clearInterval(nativeUrlTimerClose);
					nativeUrlTimerClose = null;
				}
			}, 10);
		};
		
		showNativeUrl = function (options) {
			if(!options || !options.permanent)
				clearTimeout(nativeUrlTimerCloseAfterTimeout);
			nativeUrlTimerCloseAfterTimeout = null;
			
			if(!options || !options.permanent)
				hideNativeUrl();
			
			if(nativeUrlVisible != true && nativeUrlTimer == null)
			{
                window.getSelection().selectAllChildren(document.getElementById("nativeUrlSpan"));

				nativeUrlPosition = -27;
				nativeUrlTimer = setInterval(function (){
					nativeUrlElement.style.top = ++nativeUrlPosition + "px";
					
					if(nativeUrlPosition >= 0)
					{
						nativeUrlVisible = true;
						clearInterval(nativeUrlTimer);

						if(nativeUrlTimerCloseAfterTimeout)
							clearTimeout(nativeUrlTimerCloseAfterTimeout);
						if(!options || !options.permanent)
							nativeUrlTimerCloseAfterTimeout = setTimeout(function() {
								if(!nativeUrlElementHover)
									hideNativeUrl ();
							}, 5000);
					}
				},9);
			}
		};
		
		document.getElementById("nativeUrlButton").onclick = showNativeUrl;
	}
	
	/************************/
	/*		Util Methods    */
	/************************/
	
	//var listenerBinded = false;
	window.drawAddPageToWhiteListDialog = function ()
	{
		if(document.getElementById("ATCSDialogiFrame"))
			return;
			
		showNativeUrl({permanent: true});
			
		document.getElementById("screen").style.filter = "blur(1px)";
		
		var iframe = document.createElement('iframe');
		iframe.id = "ATCSDialogiFrame";
		iframe.src = chrome.extension.getURL("dialog.html?dialog=page&url="+parseUrlParam('url'));
		iframe.style.position = 'fixed';
		iframe.style.top = '0px';
		iframe.style.left = '0px';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.style.zIndex = 10000000;
		iframe.frameBorder = 0;
		document.getElementsByTagName("body")[0].appendChild(iframe);
		
		/*if(!listenerBinded)
			chrome.extension.onMessage.addListener(function(request, sender, sendResponse) 
			{
				if (request.method === "[AutomaticTabCleaner:hideDialogRequetToTab]")
				{
					console.log("called");
					document.getElementById("ATCSDialogiFrame").parentElement.removeChild(document.getElementById("ATCSDialogiFrame"));
					document.getElementById("screen").style.filter = '';
					window.focus();
					
					if(request.options && request.options.goBack)
						goBack();
					else
						showNativeUrl();
				}
			});
		
		listenerBinded = true;*/
	};
	
};