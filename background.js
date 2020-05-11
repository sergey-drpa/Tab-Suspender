/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

(function (){
	var Copyright = "Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy. Zadorozhniy.Sergey@gmail.com";
	var PARSE_DECIMAL = 10;
	var DELAY_BEFORE_DB_CLEANUP = 1*60*1000;
	var DELAY_BEFORE_DB_MIGRATE_TO_INDEXEDDB = 1*60*1000;
	var tickSize = 10;
	//var slowPC = false;

	//var debug = true; /* Moved into utils.js */
	var debugPatterns = false;
	var debugInit = false;
	var debugScreenCache = false;

	/*try
	{
		slowPC = ( navigator.userAgent.search('CrOS') >= 0 ? true : false );
	}
	catch(e)
	{}*/

	var DEFAULT_SETTINGS = {
		'active': true,
		'timeout': 30 * 60,
		//'tick': 1, // seconds [Hidden]
		'pinned': true,
		'isCloseTabsOn': false,
		'ignoreAudible': true,
		'limitOfOpenedTabs': 20,
		'closeTimeout': 60*60,
		'autoRestoreTab': false,
		//'verySlowPC': slowPC,
		'restoreOnMouseHover': true,
		'reloadTabOnRestore': false,
		'exceptionPatterns': null,
		'exceptionPatternsV2': '*mail.google.com*\n*outlook.live.com*\n*service.mail.com*\n*mail.yahoo.com*\n*mail.aol.com*\n*icloud.com/#mail*\nexamplesite.com*\n*.examplesitesecond.com*', // <<=== Continue There TODO - DONE
		'animateTabIconSuspendTimeout': false,
		'restoreTabOnStartup': false,
		'parkBgColor': "FFFFFF",
		'autoSuspendOnlyOnBatteryOnly': false,
		'startDiscarted': true,
		'startNormalTabsDiscarted': false,
		'screenshotQuality': 90,
		'discardTabAfterSuspendWithTimeout': true,
		'discardTimeoutFactor': 0.2,
		'openUnfocusedTabDiscarded': false,
        'enableSuspendOnlyIfBattLvlLessValue': false,
		'battLvlLessValue': 50,
		'screenshotCssStyle': '',
        'adaptiveSuspendTimeout': true,
		'restoreButtonView': 'roundIcon' /* Available: roundIcon, noIcon, topBar */
	};

	function createNewTabInfo(tab){
		return {
			'id': tab.id,
			'winId': tab.windowId,
			'idx': tab.index,
			'time': 0,
			'suspended_time': 0,
			'active_time': 0,
			'swch_cnt': 0,
			'parkTrys': 0,
			'lstCapUrl': tab.url,
			'lstCapTime': null,
			'lstSwchTime': null,
			'v': 2,
			'suspendPercent': 0,
			'discarded': tab.discarded,
			'markedForDiscard': false,
            'parkedCount': 0,
            'parkedUrl': null,
            'nonCmpltInput': false
		};
	}

    var c5 = chrome;
    var t5 = c5.tabs;
    var e5 = c5.extension;
    var r5 = c5.runtime;

	var extUrl;// = e5.getURL('park.html');

	// Globals
	var rootExtensionUri = e5.getURL('');
	var sessionsPageUrl = e5.getURL('sessions.html');
	var database;
    var webSqlDatabase;
	var tabs = {}; // list of tabIDs with inactivity time {'id', 'time', 'active_time', 'swch_cnt', 'screen', 'parkTrys'}
	var HISTORY_KEEP_LAST_N_ITEMS = 150;
	var parkHistory = [];
	var closeHistory = [];
	window.tabScreens = {}; // map of tabIDs with last 'screen'
	var ignoreTabList = {};
	var ticker = null;
	var tickCount = 0;
	var settings = {};
	var debugTabsInfo = false;
	//var exceptionPatterns = []; /* DEPRECATED! */
	var whiteList;
	var globalMenuIdMap;
	var pauseTics = 0;
	var pauseTicsStartedFrom = 0;
	var isCharging = true;
	var startedAt = new Date().getTime();
	var firstTimeTabDiscardMap = {};
	var screenshotQuality;
	var formRestoreController = new FormRestoreController();
	var browser = detectBrowser();
	var tabsMarkedForUnsuspend = [];
	var TABS_MARKED_FOR_UNSUSPEND_TTL = 5000;
	var historyOpenerController = new HistoryOpenerController();
	var batteryLevel = -1.0;
	var dbMovedFromWebSqlToIndexedDB=false;
	var getScreenCache=null;
    var wizardPageUrl = e5.getURL('wizard_background.html');
    var settingsInitedResolve, settingsInitedPromise = new Promise(function(resolve, reject){
        settingsInitedResolve = resolve;
    });
    var lastWindowDevicePixelRatio = {};
	//var userDisplayHeight = null;

	var storageTabScreenPrefix = 'ATCSTab';
	var settingsStorageNamespace = 'tabSuspenderSettings'; /* Also has duplicats in fancy-settings/../settings.js */

	window.popupQuery = function (tab){
		if(debug)
            console.log('popupQuery Requested.');

		var tabURLAllowedForPark = isTabURLAllowedForPark(tab);
		var parked;
		try {
			parked = tabs[tab.id].parked;
		} catch(e) {}

		if(debug)
			console.log('Park alowed: '+tabURLAllowedForPark, 'parked: ',parked==true ,tab);

		return {
			successful: true,
			tabId: tab.id,
			allowed: tabURLAllowedForPark,
			timeout: settings.get('timeout'),
			parked: parked==true,
			pauseTics: pauseTics,
			pauseTicsStartedFrom:
			pauseTicsStartedFrom,
			isTabInIgnoreTabList: isTabInIgnoreTabList(tab.id),
			isTabInWhiteList: (parked ? whiteList.isURIException(parseUrlParam(tab.url, 'url')) : whiteList.isURIException(tab.url) ),
			isCloseTabsOn: settings.get('isCloseTabsOn'),
			closeTimeout: settings.get('closeTimeout'),
			limitOfOpenedTabs: settings.get('limitOfOpenedTabs'),
			TSVersion: chrome.runtime.getManifest().version
		};
	};

	//TODO: COMMENTED FOR TESTS: function addScreen (id, screen, devicePixelRatio){
	window.addScreen = function (id, screen, devicePixelRatio){
		"use strict";

		if(screen != null)
		{
			var data =
                {
                    'id': parseInt(id),
                    'sessionId': window.TSSessionId,
                    'added_on': new Date(),
                    'screen': screen,
                    'pixRat': devicePixelRatio
                };

			console.log('devicePixelRatio['+id+','+window.TSSessionId+']: ', devicePixelRatio);
            if(devicePixelRatio == null)
                console.error('addScreen(): devicePixelRatio is null!!!');

            database.put(
                {
                    IDB:
                        {
							table: 'screens',
                        	data: data
						},
					WebSQL:
						{
							/*query: 'insert or replace INTO screens(id, sessionId, added_on, screen) VALUES (?,?,?,?)',
							data: [data.id, data.sessionId, data.added_on, data.screen]*/
						}
                }
            )
        }
	}

	window.getScreen = function (id, sessionId, callback){
		"use strict";

        if(debugScreenCache)
			console.log("getScreen called for tabId: "+id, Date.now());

        if(database.isInitialized() != true)
        {
            console.log("getScreen DB is not initialized yet waiting...: "+id, Date.now());
            database.getInitializedPromise().then(function ()
            {
                getScreen(id, sessionId, callback);
            });
            return;
        }

		if(sessionId == null)
            sessionId = window.TSSessionId;

		if(getScreenCache != null)
        {
        	if(getScreenCache.sessionId == sessionId && getScreenCache.tabId == id)
            {
                getScreenCache.getScreenPromise.then(function ()
                {
                    if(debugScreenCache)
                        console.log("getScreen then handler added");
                    callback(getScreenCache.screen, getScreenCache.pixRat);
                    getScreenCache = null;
                    if(debugScreenCache)
                    	console.log("Screen got from cache!!");
                });
                return;
            }
            else
                getScreenCache = null;
        }

		var currentDB;
		if(dbMovedFromWebSqlToIndexedDB == true || isCurrentSessionAfter(sessionId))
			currentDB = database;
		else
			currentDB = webSqlDatabase;

        currentDB.queryIndex(
			{
				IDB:
					{
						table: 'screens',
                        index: 'PK'
					},
				WebSQL:
					{
						/*query: 'select screen from screens where id = ? and sessionId = ?'*/
					},
				params: [parseInt(id), parseInt(sessionId)]},
			function(fields)
			{
				if(fields == null)
				{
					callback(null);
					return;
				}

				if(debugScreenCache)
					console.log("getScreen result: ", Date.now());
				callback(fields['screen'], fields['pixRat'] || 1);
			}
		);
	}

	function isCurrentSessionAfter(timestamp)
	{
		if(parseInt(timestamp) >= parseInt(window.TSSessionId))
			return true;
		return false;
	}

    window.isScreenExist = function (id, sessionId, callback) {
        "use strict";

        if (sessionId == null)
            sessionId = window.TSSessionId;

        var currentDB;
        if(dbMovedFromWebSqlToIndexedDB == true)
            currentDB = database;
        else
            currentDB = webSqlDatabase;

        currentDB.queryIndexCount(
            {
                IDB:
                    {
                        table: 'screens',
                        index: 'PK'
                    },
                WebSQL:
                    {
                        query: 'select count(*) from screens where id = ? and sessionId = ?'
                    },
                params: [parseInt(id), parseInt(sessionId)]},
            callback
        );
    }

	function removeScreen(id){
		"use strict";

		/* No need to delete in case of reopen tab, will be cleaned after restart */
		//delete tabScreens[id];
		//localStorage.removeItem(storageTabScreenPrefix + id);
	}

	window.getRestoreEvent = function ()
	{
		"use strict";

		return (settings.get('restoreOnMouseHover') == true ? 'hover' : 'click');
	}

	window.getReloadTabOnRestore = function ()
	{
		"use strict";

		return settings.get('reloadTabOnRestore');
	}

	window.getRestoreButtonView = function ()
	{
        "use strict";

        return settings.get('restoreButtonView');
	}

    window.getScreenshotCssStyle = function ()
    {
        "use strict";

        return settings.get('screenshotCssStyle');
    }

	window.getStartDiscarted = function()
	{
        "use strict";

        return settings.get('startDiscarted');
	}

	window.isFirstTimeTabDiscard = function(tabId)
	{
        var isFirstTime = !(tabId in firstTimeTabDiscardMap);
        firstTimeTabDiscardMap[tabId] = true;
        return isFirstTime;
	}

	window.getParkBgColor = function ()
	{
		"use strict";
		var color = settings.get('parkBgColor');
		if(color != null && color.search(/^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) >= 0)
			return color;
		else
			return DEFAULT_SETTINGS.parkBgColor;
	}

	function addToIgnoreTabList(tabId){
		"use strict";

		ignoreTabList[tabId] = true;

        new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	window.isTabInIgnoreTabList = function (tabId){
		"use strict";

		return ignoreTabList[tabId] != null;
	}

	window.getStartedAt = function (){
        "use strict";

		return startedAt;
	}

	/*window.getUserDisplayHeight = function (){
		return userDisplayHeight;
	}*/

	window.isTabMarkedForUnsuspend = function (tabIdStr, sessionIdStr, options)
	{
        "use strict";

        //console.log("isTabMarkedForUnsuspend: tabsMarkedForUnsuspend: ", tabIdStr, sessionIdStr, tabsMarkedForUnsuspend);

        if(tabsMarkedForUnsuspend.length <= 0)
        	return false;

        var now = Date.now();
        var tabId = parseInt(tabIdStr);
        var sessionId = parseInt(sessionIdStr);
        for(var i=0; i<tabsMarkedForUnsuspend.length; i++)
            if (now - tabsMarkedForUnsuspend[i].at <= TABS_MARKED_FOR_UNSUSPEND_TTL && tabsMarkedForUnsuspend[i].tabId == tabId && tabsMarkedForUnsuspend[i].sessionId == sessionId)
			{
				if(options && options.remove)
                {
                    //console.log("isTabMarkedForUnsuspend: splice ", tabsMarkedForUnsuspend[i]);
                    tabsMarkedForUnsuspend.splice(i, 1);
                }
            	return true;
        	}

        //console.log("isTabMarkedForUnsuspend: ",tabIdStr, sessionIdStr, tabsMarkedForUnsuspend);
        return false;
	}

	window.getTabInfo = function(tab)
	{
		var tabInfo = tabs[tab.id];

		if(tabInfo == null)
			tabs[tab.id] = tabInfo = createNewTabInfo(tab);

		return tabInfo;
	}

	function removeFromIgnoreTabList(tabId){
		"use strict";

		delete ignoreTabList[tabId];

        new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	function isTabURLAllowedForPark(tab){
		"use strict";

		return (tab.url.substring(0, tab.url.indexOf(':')) == 'http' ||
			tab.url.substring(0, tab.url.indexOf(':')) == 'https' ||
			tab.url === wizardPageUrl);
	}


	function isExceptionTab(tab){
		"use strict";

		try
		{
			return isTabExceprion (tab) || whiteList.isURIException(tab.url);
		}
		catch (ex)
		{
			console.error(ex);
			return isTabExceprion (tab);
		}
	}

	function isTabExceprion (tab)
	{
		// Audiable
		if(isAudiable(tab) && settings.get('ignoreAudible'))
			return true;

		// Pinned Tab
		if(tab.pinned == true && settings.get('pinned'))
			return true;

		//Tab Ignore List
		if(isTabInIgnoreTabList(tab.id))
			return true;

		// Not complete input
		if(getTabInfo(tab).nonCmpltInput)
            return true;

		return false;
	}

	function isAudiable(tab)
	{
		return (typeof tab.audible == "boolean" && tab.audible == true);
	}

	/* Park Pool Woker - Separate thread to park tabs */
	/*function parkPollWoker()
	{
		if(parkPoll.length > 0)
		{
			var tab = parkPoll.pop();
			parkTab(tab, tab.id);
		}
	}*/

	function parkTabs(requestTab, windowId)
	{
		var callbackSingle = function (window)
		{
			var number = 0;
			for (var j in window.tabs)
				if (window.tabs.hasOwnProperty(j))
					if(requestTab == null || (requestTab != null && windowId != null) || window.tabs[j].id != requestTab.id)
						if(isTabURLAllowedForPark(window.tabs[j]))
							if(!isExceptionTab(window.tabs[j]))
								parkTab(window.tabs[j], window.tabs[j].id, {bulkNumber: (window.tabs[j].discarded ? number++ : null)});
		};

		var callbackAll = function (windows)
		{
			for (var wi in windows)
				if (windows.hasOwnProperty(wi))
						callbackSingle(windows[wi]);
		};

		if(windowId != null)
			c5.windows.get(windowId, {'populate': true}, callbackSingle);
		else
			c5.windows.getAll({'populate': true}, callbackAll);
	}

	// park idle tab if it is not parked yet
	function parkTab(tab, tabId, options) {
        "use strict";

        if (!isTabURLAllowedForPark(tab))
            return;

        if (tab.discarded && (options == null || options.reloaded == false))
        {
            t5.reload(tabId, function () {
                setTimeout(function() {
                    parkTab(tab, tabId, {reloaded: true});
                }, (options != null && options.bulkNumber > 0 ? bulkNumber*1000 : 1000));
            });
            return;
    	}

		/* Save history */
		try
		{
			var duplicate = false;
			if(parkHistory.length > 0 && parkHistory[0].tabId != null && parkHistory[0].sessionId != null)
				if(parkHistory[0].tabId == tabId && parkHistory[0].sessionId == window.TSSessionId)
					duplicate = true;
			if(!duplicate)
			{
				parkHistory.splice(0, 0, {timestamp: (new Date()).getTime(), url: tab.url, title: tab.title, tabId: tabId, sessionId: window.TSSessionId});
				parkHistory.splice(HISTORY_KEEP_LAST_N_ITEMS);
				localStorage.setItem('parkHistory', JSON.stringify(parkHistory));
			}

			formRestoreController.hebernateFormData(tabId);
		}
		catch (e)
		{
			console.error(e);
		}

		/* Detached from thread for hebernateFormData have chance to process */
		setTimeout(function ()
		{
            isScreenExist(tabId, null, function(screenExist)
			{
				if(screenExist == null || parseInt(screenExist) <= 0)
				{
					if(debug)
						console.log("Screen Not Exist");

                    getTabInfo(tab).lstCapUrl = tab.url;

					var tabParked = false;
					//var isPageHasNonCompleteInput = false;
					var closureTabId = tabId;
					var closureTab = tab;
					var checkTabIsParked;
					var checkTabIsParkedTimeout;

					var parkByMessage = function(closureTab, closureTabId) {
						c5.windows.get(closureTab.windowId, function(win){
							var width = null;
							if(closureTab.width == null || closureTab.width == 0)
								width = win.width - 20;
							var height = win.height;

							t5.sendMessage(closureTabId, {method: "[AutomaticTabCleaner:ParkPageFromInject]", 'tabId': closureTab.id, 'sessionId': window.TSSessionId, 'width': width, 'height': height},
								function (response) {
									if(response != null)
									{
										if (response.result == 'successful')
										{
											tabParked = true;
											markTabParked(closureTab);
										}
										else if(checkTabIsParked != null)
											checkTabIsParked();
										/*if (response.result == 'pageHasNonCompleteInput')
										{
											isPageHasNonCompleteInput = true;
											console.log('ParkTab['+closureTab+'] prevented: ' + response.result);
										}*/
									}
									console.log("ParkPageFromInject response: " + response);
							});
						});
					};

					parkByMessage(closureTab, closureTabId);

					/*	TODO:	Invesigate https://yandex.ru/maps/2/saint-petersburg/?ll=30.414844%2C60.004372&z=12&mode=search&text=molly&sll=30.414844%2C60.004372&sspn=0.372849%2C0.003782&sctx=ZAAAAAgBEAAaKAoSCVnaqbncUD5AEQZwqwdp901AEhIJwSUCAMDc5z8ROPBhbOXJyz8gACABIAIgAygFMAE4%2BYuinpTW%2BYw1QL2CBkgBVcH%2Bfz9YAGIjZGlyZWN0X2RvbnRfc2hvd19vbl9jaGFpbl9yZXF1ZXN0PTFiKGRpcmVjdF9kb250X3Nob3dfb25fcnVicmljX3dpdGhfYWR2ZXJ0PTFqAnJ1cAA%3D					*/
					/*  DOMException: Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported. */
					/*  Try to reinject JS if parked failed */
					/*								*/
					checkTabIsParkedTimeout = setTimeout(checkTabIsParked = function(){
						if(checkTabIsParkedTimeout != null){
							clearTimeout(checkTabIsParkedTimeout);
							checkTabIsParkedTimeout = null;
						}

						if(tabParked == false/* && isPageHasNonCompleteInput == false*/)
						{
							injectJS(closureTabId);
							parkByMessage(closureTab, closureTabId);
						}
					}, 10000);
				}
				else
					try{
                        if(debug)
                            console.log("Screen Exist");
						//check if parked
						if (tab != null /*&& !tab.active && isTabURLAllowedForPark(tab)*/)
						{
							t5.sendMessage(tabId, {method: "[AutomaticTabCleaner:getOriginalFaviconUrl]"}, function (originalFaviconUrl){

								if(debug)
									console.log("originalFaviconUrl: ",originalFaviconUrl);

								var url = extUrl + '?title=' + encodeURIComponent(tab.title);
								url += "&url=" + encodeURIComponent(tab.url);
								url += "&tabId=" + encodeURIComponent(tabId);
                                url += "&sessionId=" + encodeURIComponent(window.TSSessionId);

								if(originalFaviconUrl != null && originalFaviconUrl != "")
									url += '&icon=' + encodeURIComponent(originalFaviconUrl);
								else if (tab.favIconUrl)
									url += '&icon=' + encodeURIComponent(tab.favIconUrl);

								t5.update(tab.id, {'url': url});
							});
						}

                        markTabParked(tab);
					}
					catch(e)
					{
						console.error("Park by link failed: ",e);
					}
            });
		}, 200);
	}

	function markTabParked(tab)
	{
        if(getTabInfo(tab).parkedUrl != null)
        {
            if (extractHostname(getTabInfo(tab).parkedUrl) == extractHostname(getTabInfo(tab).lstCapUrl))
                getTabInfo(tab).parkedCount += 1;
            else
                getTabInfo(tab).parkedCount = 0;
        }
        else
            getTabInfo(tab).parkedCount += 1;

        if(tab.url.indexOf(extUrl) == 0)
       		getTabInfo(tab).parkedUrl = getParameterByName("url",tab.url); //getTabInfo(tab).lstCapUrl;
		else
            getTabInfo(tab).parkedUrl = tab.url;

		//console.warn('perkedUrl => '+getTabInfo(tab).parkedUrl);

		getTabInfo(tab).parked = true;
	}

	function unsuspendTabs(windowId)
	{
		"use strict";

		var openedIndex = 1;

		var callbackSingle = function (window)
		{
			"use strict";

			for (var j in window.tabs)
				if (window.tabs.hasOwnProperty(j))
					if (isTabParked(window.tabs[j]))
					{
						var tabInfo = tabs[window.tabs[j].id];

                        var tmpFunction = function (j){
                            var tab = window.tabs[j];
                            var clzOpenedIndex = openedIndex++;
                            setTimeout(function (){
                                unsuspendTab(tab);
                            },1000*clzOpenedIndex);
                        }

						tmpFunction(j);
					}
		};

		var callbackAll = function (windows)
		{
			"use strict";

			for (var wi in windows)
				if (windows.hasOwnProperty(wi))
					callbackSingle(windows[wi]);
		};


		if(windowId != null)
			c5.windows.get(windowId, {'populate': true}, callbackSingle);
		else
			c5.windows.getAll({'populate': true}, callbackAll);
	}

	function unsuspendTab(tab)
	{
        if(tab.discarded == true)
        {
            markForUnsuspend(tab);
            t5.reload(tab.id, function () {
                /*setTimeout(function() {
                    _unsuspendTab(tab);
                }, 300);*/
            });
        }
        else
        {
            if(tab.status == "loading")
            {
            	if(settings.get('reloadTabOnRestore') == true)
                    t5.update(tab.id, {'url': parseUrlParam(tab.url,'url')});
            	else
            	{
                    markForUnsuspend(tab);
                    //_unsuspendTab(tab);
                }
            }
            else
            	_unsuspendTab(tab);
        }
	}

    function markForUnsuspend(tab)
    {
        var o = {
            tabId: parseInt(parseUrlParam(tab.url,'tabId')),
            sessionId: parseInt(parseUrlParam(tab.url,'sessionId')),
            at: Date.now()
        };
        tabsMarkedForUnsuspend.push(o);

        //console.log('OnActivate Add: ', o);

		/* CLEANUP tabsMarkedForUnsuspend */
        var now = Date.now();
        for(var i=0; i<tabsMarkedForUnsuspend.length; i++)
        {
            if(now-tabsMarkedForUnsuspend[i].at > TABS_MARKED_FOR_UNSUSPEND_TTL) {
                //console.log('onActivate: tabsMarkedForUnsuspend: splice',tabsMarkedForUnsuspend[i]);
                tabsMarkedForUnsuspend.splice(i,1);
                i--; // Prevent skipping an item
            }
        }

        //console.log('onActivate: tabsMarkedForUnsuspend: ',tabsMarkedForUnsuspend);
    }

	function _unsuspendTab(tab)
	{
        "use strict";

        r5.sendMessage({'method': "[AutomaticTabCleaner:RestoreMessage]", 'tab': tab});
	}

	function closeTab(tabId, tab)
	{
		/* Save history */
		try
		{
			closeHistory.splice(0, 0, {timestamp: (new Date()).getTime(), url: tab.url, title: tab.title, tabId: parseUrlParam(tab.url, 'tabId'), sessionId: parseUrlParam(tab.url, 'sessionId')});
			closeHistory.splice(HISTORY_KEEP_LAST_N_ITEMS);
			localStorage.setItem('closeHistory', JSON.stringify(closeHistory));

			reloadHistoryPage();
		}
		catch (e)
		{
			console.error(e);
		}

		t5.remove(tabId, null);
	}

	// simple timer - update inactivity time, unload timeouted tabs
	function tick(stateOnly) {
		"use strict";

        navigator.getBattery().then(function(battery) {
            //console.log("Level: ", battery.level);

            if(battery != null && battery.level != null &&  battery.level >= 0.0)
                batteryLevel = battery.level;
        });

		if(!stateOnly)
		{
			tickCount+=tickSize;

			if(pauseTics > 0)
			{
				pauseTics-=tickSize;
				if(pauseTics <= 0)
				{
					new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
					pauseTicsStartedFrom = 0;
				}
				return;
			}
		}

		var tabStatusChanged = false;
		var pinnedSettings = settings.get('pinned');
		var titeoutSettings = settings.get('timeout');
		var isCloseTabsOn = settings.get('isCloseTabsOn');
		var ignoreAudible = settings.get('ignoreAudible');
		var animateTabIconSuspendTimeout = settings.get('animateTabIconSuspendTimeout');
		var autoSuspendOnlyOnBatteryOnly = settings.get('autoSuspendOnlyOnBatteryOnly');
		var discardTabAfterSuspendWithTimeout = settings.get('discardTabAfterSuspendWithTimeout');
        var discardTimeoutFactor = settings.get('discardTimeoutFactor');
        var enableSuspendOnlyIfBattLvlLessValue = settings.get('enableSuspendOnlyIfBattLvlLessValue');
        var battLvlLessValue = settings.get('battLvlLessValue');
        var adaptiveSuspendTimeout = settings.get('adaptiveSuspendTimeout');

        if(batteryLevel < 0.0)
            enableSuspendOnlyIfBattLvlLessValue = false;


		var cleanedTabsArray = {};

		c5.windows.getAll({'populate': true}, function (windows)
		{
			// increment every tab time
			/*for (var i in tabs) {
				if (tabs.hasOwnProperty(i)) {
					tabs[i].time += settings.get('tick');

					if (tabs[i].time >= settings.get('timeout'))
					{
						if(tabExist (windows, i)){
							if()
							if(tabs[i].screen != null)
								t5.get(parseInt(i, PARSE_DECIMAL), parkTab);
							else
								t5.get(parseInt(i, PARSE_DECIMAL), function(tab) {
									t5.sendMessage(tab.id, {method: "[AutomaticTabCleaner:ParkPageFromInject]", 'tab': tab}, function(response) {});//c5.runtime.sendMessage("[AutomaticTabCleaner:ParkPageFromInject]");
								});
							break;
						}
						else
							delete tabs[parseInt(i, PARSE_DECIMAL)];
					}
				}
			}*/


			// CLOSE TAB LOGIC
			if(!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging)
				if(isCloseTabsOn && tickCount % tickSize == 0){
					var oneTabClosed = false;
					for (var wi in windows) {
						// TDDO: add saparation per window.
						var tabArray = [];

						if (windows.hasOwnProperty(wi))
						for (var j in windows[wi].tabs)
							if (windows[wi].tabs.hasOwnProperty(j))
								if (tabs.hasOwnProperty(windows[wi].tabs[j].id)){
									if(!isExceptionTab(windows[wi].tabs[j])) /*if(ignoreAudible && !isAudiable(windows[wi].tabs[j]) || !ignoreAudible)*/
										tabArray.push(tabs[windows[wi].tabs[j].id]);
								}

						//tabArray.sort(function(a,b){ return a.active_time*(a.swch_cnt+1)-a.time < b.active_time*(b.swch_cnt+1)-b.time ? 1 : -1; });

						var i = 0;
						var minRank = 19999999999;
						var minRankTab;
						if(tabArray.length > settings.get('limitOfOpenedTabs')){
							for(var i=0; i < tabArray.length; i++){
								if(tabArray[i].time >= settings.get('closeTimeout')){
									var currentRank = tabArray[i].active_time*tabArray[i].active_time*(tabArray[i].swch_cnt+1)-tabArray[i].time*(tabArray[i].parked ? tabArray[i].time : 2);
									if(minRank > currentRank) {
										minRank = currentRank;
										minRankTab = tabArray[i];
									}
									if(debug)
										console.log(currentRank, " : ", tabArray[i]);
								}
							}
						}

						if(minRankTab != null)
						{
							var tabToClose = null;
							if((tabToClose=tabExist (windows, minRankTab.id)) != null) {
								/*TODO: check for tab is last on whole window!!!*/

								/*for (var j in windows[wi].tabs)
									if (windows[wi].tabs.hasOwnProperty(j))
									{
										tabToClose = windows[wi].tabs[j];
										break;
									}*/

								if(!stateOnly)
									closeTab(minRankTab.id, tabToClose);
								//delete tabs[minRankTab.id]; //would be removed onRemove tab event
								oneTabClosed = true;
								tabStatusChanged = true;
								break;
							}
						}

						if(oneTabClosed)
							break;
					}

				}

			var steps = 10;
			var oneTabParked = false;
            var parkedUrls = [];
			var refreshIconIndex=0;

			// SUSPEND TAB LOGIC
			for (var i in windows) {
				if (windows.hasOwnProperty(i)) {
					for (var j in windows[i].tabs) {
						if (windows[i].tabs.hasOwnProperty(j)) {

							try
							{
								if(debugTabsInfo)
									console.log(i, j, windows[i].tabs[j]);
							}
							catch(e)
							{
								//debugger;
							}


							var tabId = windows[i].tabs[j].id;

							var tabInfo = null;

							if(!tabs.hasOwnProperty(tabId))
							{
								tabInfo = createNewTabInfo(windows[i].tabs[j]);
								tabs[tabId] = tabInfo;
							}
							else
								tabInfo = tabs[tabId];

							cleanedTabsArray[tabId] = tabInfo;


							/*if (tabs.hasOwnProperty(tabId)) */
							{
								var isTabParked = windows[i].tabs[j].url != null && windows[i].tabs[j].url.indexOf(extUrl)==0;

								/* Restore session logic When uninstall */
								/*if(isTabParked)
                                    parkedUrls.push(parseUrlParam(windows[i].tabs[j].url,'url'));*/

								if(!stateOnly)
								{
									tabInfo.time += tickSize;

									if(isTabParked)
										tabInfo.suspended_time += tickSize;
								}

								if(!oneTabParked /*&& tickCount % 5 == 0*/)
								{
									if(tabInfo.parkedCount == null)
                                        tabInfo.parkedCount = 0;

									var calculatedTabTimeFrame = titeoutSettings+titeoutSettings*tabInfo.parkedCount + (tabInfo.active_time+1)*Math.log2(tabInfo.swch_cnt+1)+(titeoutSettings/4)*Math.log2(tabInfo.swch_cnt+1);

									if(extUrl !== 'chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/park.html')
										chrome.browserAction.setBadgeText({text: ""+Math.round((calculatedTabTimeFrame - tabInfo.time)/60)+'|'+tabInfo.swch_cnt, tabId: windows[i].tabs[j].id});

									if (!adaptiveSuspendTimeout && tabInfo.time >= titeoutSettings
										|| adaptiveSuspendTimeout && tabInfo.time >= calculatedTabTimeFrame)
									{
										if(!windows[i].tabs[j].active &&
											windows[i].tabs[j].status == "complete" &&
											isTabURLAllowedForPark(windows[i].tabs[j]) &&
											tabInfo.parkTrys <= 2)
										{
											if(!isExceptionTab(windows[i].tabs[j]))
											{
												if(!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging)
												{
													if(enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue/100 && !isCharging)
                                                    {
                                                        if (!stateOnly)
                                                        {
                                                            parkTab(windows[i].tabs[j], tabId);
                                                            tabInfo.parkTrys++;
                                                        }
                                                        oneTabParked = true;
                                                        tabStatusChanged = true;
                                                    }
												}
											}
											else
											{
												tabInfo.time=0;
												/* TODO: Make a favicon locks
												if (windows[i].tabs[j].favIconUrl)
													t5.executeScript(windows[i].tabs[j].id,
													{
														code: "lockFavIcon('"+windows[i].tabs[j].favIconUrl+"');"
													});*/
											}
										}
										/*else
											delete tabs[parseInt(j, PARSE_DECIMAL)];*/
									}
									else
									{
										if(!stateOnly)
											if(animateTabIconSuspendTimeout &&
												!windows[i].tabs[j].active &&
												tabInfo.time > 0 &&
												!isExceptionTab(windows[i].tabs[j]) &&
												isTabURLAllowedForPark(windows[i].tabs[j]) &&
												(!autoSuspendOnlyOnBatteryOnly || autoSuspendOnlyOnBatteryOnly && !isCharging) &&
												(enableSuspendOnlyIfBattLvlLessValue == false || enableSuspendOnlyIfBattLvlLessValue == true && batteryLevel < battLvlLessValue/100 && !isCharging))
											{
												var step = Math.round(tabInfo.time / ((titeoutSettings+titeoutSettings*(2/steps)) / steps));
												var suspendPercent = step*10;
												if(tabInfo.suspendPercent != suspendPercent)
												{
													tabInfo.suspendPercent = suspendPercent;
													t5.sendMessage(tabId, {method: "[AutomaticTabCleaner:highliteFavicon]", highliteInfo: {suspendPercent: suspendPercent}});
												}
											}
									}
								}

								/* PINNED TABS */
								if(ignoreAudible && isAudiable(windows[i].tabs[j]))
									tabInfo.time=0;

								/* DISCARD TABS */
								if(isTabParked)
								{
                                    tabInfo.discarded = windows[i].tabs[j].discarded;

									/* Refresh susp. tab empty icons */
									if(windows[i].tabs[j].favIconUrl==null || windows[i].tabs[j].favIconUrl === ''){
										var tmpFunction = function (id, discard, index){
										setTimeout(function (){
												//if(debug)
													console.log("Refresh susp. tab icon: " + id);
												//console.log("Wrong discarded: ", tabs[i].url, tabs[i],"Reload..");
												chrome.tabs.reload(id, function(){
													if(discard)
														setTimeout(function (){
															discardTab(id);
														}, 2000);
												});
											},100*index);
										};
										tmpFunction(windows[i].tabs[j].id, tabInfo.discarded, refreshIconIndex++);
									}

                                    if (!tabInfo.discarded && discardTabAfterSuspendWithTimeout)
                                        if (!windows[i].tabs[j].active) {
                                            if (tabInfo.suspended_time >= titeoutSettings * discardTimeoutFactor) {
                                            	if(!isTabMarkedForUnsuspend(parseUrlParam(windows[i].tabs[j].url,'tabId'), parseUrlParam(windows[i].tabs[j].url,'sessionId')))
                                                {
                                                    try
                                                    {
														//console.log("Dsicard: "+windows[i].tabs[j].url);
                                                        discardTab(windows[i].tabs[j].id);
                                                    }
                                                    catch (e)
                                                    {
                                                        //console.error("On Discard:", e);
                                                        console.log("Disacrd failed: ", windows[i].tabs[j]);
                                                    }

                                                    tabInfo.discarded = true;
                                                }
                                            }
                                        }
                                }

								/* DEBUG INFO */
								if(debug) {
									if(isTabURLAllowedForPark(windows[i].tabs[j]) && windows[i].tabs[j].discarded == false) {
										try {
											t5.executeScript(windows[i].tabs[j].id,{code:"document.title = '"+appendTitleDebug(windows[i].tabs[j].title, tabInfo)+"'"});
										}
										catch (e)
										{debugger}
									}
									/*if(isTabParked(windows[i].tabs[j])){
										var arrayOfwindowObjects = e5.getViews({type: "tab"});
										for(var k=0;k<arrayOfwindowObjects.length;k++){
											arrayOfwindowObjects[k].document.title = appendTitleDebug(windows[i].tabs[j].title, tabInfo);
										}
									}*/
								}
							}

							if(!stateOnly)
							{
								/*								*/
								/* !!!!!!! LOOKS LIKE DEAD CODE !!!!!!! */
								/*								*/
								if (windows[i].tabs[j].active) {
									if(tabs[windows[i].tabs[j].id] != null)
									{
										tabs[windows[i].tabs[j].id].time = 0;
										tabs[windows[i].tabs[j].id].active_time += tickSize*(isAudiable(windows[i].tabs[j]) ? 1.5 : 1);
										tabs[windows[i].tabs[j].id].suspended_time = 0;
										tabs[windows[i].tabs[j].id].parkTrys = 0;
									}
									/*0.4.8: if(isTabURLAllowedForPark(windows[i].tabs[j]))
										captureTab(windows[i].tabs[j]);*/
								}
								if (pinnedSettings && windows[i].tabs[j].pinned)
									tabs[windows[i].tabs[j].id].time = 0;
							}
						}
					}
				}
			}

			tabs = cleanedTabsArray;

			if(stateOnly || tabStatusChanged || tickCount % 60 == 0 )
				storeTabs (tabs);

			/* Restore session logic When uninstall */
			//if(parkedUrls.length != 0)
            //    chrome.tabs.query({url: ['http://*/*', 'https://*/*']}, function(tabs) {
            //        tabs.forEach(function(tab) {
            //            t5.sendMessage(tab.id, {method: "[AutomaticTabCleaner:backupSuspendedPagesUrls]", 'suspendedUrls': parkedUrls});
            //        });
            //    });

			//localStorage.setItem('tabsInfo', JSON.stringify(tabs
			/*,function replacer(key, value) {
				  if (key == "screen") {
					return undefined;
				  }
				  return value;
				}*/
			//));
			//chrome.storage.local.set({'tabsInfo': tabs});

			/*
				JSON.stringify(tabs,function replacer(key, value) {
				  if (key == "screen") {
					return undefined;
				  }
				  return value;
				});
			*/
		});

		//chrome.storage.local.set({'tabs': tabs});
	}

	function storeTabs (tabs)
	{
		//localStorage.setItem('tabsInfo', JSON.stringify(tabs
				/*,function replacer(key, value) {
				  if (key == "screen") {
					return undefined;
				  }
				  return value;
				}*/
		//));
	}

	function discardTab(tabId){
        t5.discard(tabId, function(tab){
        	hasLastError();
        	//console.log("Discarded: OK", tab);

			/*if (tab.url.indexOf(extUrl) == 0)
				t5.update(tab.id, {url: tab.url.replace(/tabId=\d+/, 'tabId='+tab.id)}, function ()
				{
					hasLastError();
				});*/
        });
	}

    function captureTab(tab, options)
    {
        "use strict";

        if(options == null || options.checkActiveTabNotChanged != true)
            _captureTab(tab);
        else
		{
            t5.get(tab.id, function (tab) {
                if(hasLastError())
                    return;

            	if(tab != null)
                	_captureTab(tab);
            });
		}
    }

	function _captureTab(tab/*, trys*/)
	{
		"use strict";
		return new Promise(function(resolve, reject) {
			try {
				var id = tab.id;
				if (tab.active == true) {
					if (!tabs.hasOwnProperty(id))
						tabs[id] = createNewTabInfo(tab);

					if (tab.status != null && tab.status != "loading")
						try {
							t5.captureVisibleTab(tab.windowId, {
								format: "jpeg",
								quality: screenshotQuality
							}, function (screen) {
								/*if(chrome.runtime.lastError.message === "Either the '<all_urls>' or 'activeTab' permission is required." &&
									trys == null)
                                    chrome.permissions.request({
                                        permissions: ['activeTab']
                                    }, function(granted) {
                                        if (granted) {
                                            console.log('ActiveTab permission granted!');
                                            _captureTab(tab, 1);
                                        } else {
                                            hasLastError();
                                        }
                                    });*/

								if (hasLastError("The 'activeTab' permission is not in effect because this extension has not been in invoked.",
									/*'Cannot access contents of url "". Extension manifest must request permission to access this host.',
                                    'Cannot access contents of url "file:///". Extension manifest must request permission to access this host.',
                                    'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',*/
									'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
									'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab',
									'RegExp:Cannot access contents of url "' + rootExtensionUri + '.*',
									'RegExp:No window with id: \\d{1,5}\\.',
									'Failed to capture tab: view is invisible',
									'No active web contents to capture')){
									reject();
									return;
								}

								if (screen === 'data:,')
									console.error(new Error('Damaged screen [data:,]!!! id:', id));


								chrome.tabs.executeScript(id, {code: "window.devicePixelRatio"},
									function (devicePixelRatio) {
										//debugger;
										if (devicePixelRatio == null)
											devicePixelRatio = lastWindowDevicePixelRatio[tab.windowId];
										else
											lastWindowDevicePixelRatio[tab.windowId] = devicePixelRatio = devicePixelRatio[0];

										try {
											addScreen(id, screen, devicePixelRatio);
											//console.log("screen.length: ", screen.length);
											//var base64Index = screen.indexOf(';base64,') + ';base64,'.length;
											//var base64 = screen.substring(base64Index);
											//var raw = window.atob(base64);
											//console.log("screen.length+atob: ", raw.length);
											tabs[id].lstCapUrl = tab.url;
											tabs[id].lstCapTime = Date.now();

											resolve();
										} catch (e) {
											//debugger;
										}
									});
							});
						} catch (e) {
							// normal behavior
						}

					return;
				}
			} catch (e) {
				console.error(e);
			}
		});
	}

	function appendTitleDebug(title, tabInfo) {
		"use strict";

		var indexOfDebufInfoStart = title.indexOf('^');
		if(indexOfDebufInfoStart==-1)
			return debugInfoString(tabInfo) + " ^ " + title;
		else
			return debugInfoString(tabInfo) + title.substring(indexOfDebufInfoStart);
	}

	function appendExcepionTabTitle(title){
		"use strict";

		if(title.substr(0,1)!='*')
			return '*'+title;
		else
			return title;
	}

	function debugInfoString(tabInfo) {
		return "["+tabInfo.time+"]["+tabInfo.active_time+"]["+tabInfo.suspended_time+"]";
	}

    r5.onMessage.addListener(function(request, sender, sendResponse) {
	//FIREFOX SUPPORT e5.onMessage.addListener(function(request, sender, sendResponse) {
		"use strict";

		if( request.method === "[AutomaticTabCleaner:trackError]") {
			var error = Error(request.message);
			error.stack = request.stack;
			console.error("[External]: "+request.message, error);
			return;
		}
		else if( request.method === "[AutomaticTabCleaner:GetTabId]") {
			sendResponse(sender.tab.id);
			return;
		}
		else if ( request.method === "[AutomaticTabCleaner:ParkPageFromInjectFinished]") {
			//if(debug)
			//	console.log("FromInjectFinished: " + request.url);
			//addScreen(request.tab.id, request.screen); //tabs[request.tab.id].screen = request.screen;
			t5.update(request.tabId, {'url': request.url});

			if(tabs[request.tabId] != null)
				tabs[request.tabId].parked = true;
			return;
		}
		/* Сase when screen moved from inject side */
		else if ( typeof request == "string") {
			var sep = request.indexOf('/');
			var screen = request.substr(sep+1);
			if(screen === 'data:,')
				console.error(new Error('Damaged screen [data:,]!!! id:', request.substr(0,sep)));

			addScreen(/*id*/request.substr(0,sep), /*screen*/screen, 1); //tabs[request.tab.id].screen = request.screen;
			return;
		}
		/*else if ( request.method == "[AutomaticTabCleaner:getTabInfo]" )
		{
			if(debug)
				console.log('Tab info Requested.');
			sendResponse({ tabInfo: tabs[sender.tab.id]});
		}*/
		else if ( request.method == "[AutomaticTabCleaner:addExceptionPatterns]" )
		{/* DEPREACTED! */
			if(debug)
				console.log('AddExceptionPatterns info Requested.');
			settings.set('exceptionPatterns', settings.get('exceptionPatterns') + "\n" + request.pattern);
			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:suspendTab]" )
		{
			if(debug)
				console.log('suspendTab Requested.');
			if(isTabURLAllowedForPark(request.tab) /*&& !isExceptionTab(request.tab)*/)
			{
				if(debug)
					console.log('Park alowed: ', request.tab);

				//var localParkTab = function () {
					parkTab(request.tab, request.tab.id);
				//}

				//_captureTab(request.tab).then(localParkTab, localParkTab);

				sendResponse({ successful: true });
			}
			else
			{
				if(debug)
					console.log('Park disalowed: ', request.tab);
				sendResponse({ successful: true });
			}
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:suspendWindow]" )
		{
			parkTabs(request.tab, request.tab.windowId);
			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:suspendAllOtherTabs]" )
		{
			if(debug)
				console.log('suspendAllOtherTabs Requested.');

			parkTabs(request.tab);

			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:unsuspendAllTabs]" )
		{
			if(debug)
				console.log('unsuspendAllTabs Requested.');

			unsuspendTabs();

			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:unsuspendWindow]" )
		{
			unsuspendTabs(request.tab.windowId);
			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:unsuspendTab]" )
		{
			unsuspendTab(request.tab);
			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:pause]" )
		{
			if(debug)
				console.log('pause Requested.');

			pauseTics = request.pauseTics;
			pauseTicsStartedFrom = request.pauseTics;

			new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();

			sendResponse({ successful: true, pauseTics: pauseTics });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:ignoreTab]" )
		{
			if(debug)
				console.log('ignoreTab Requested.');

			if(request.action == "add")
				addToIgnoreTabList(request.tabId);
			else if(request.action == "remove")
				removeFromIgnoreTabList(request.tabId);

			sendResponse({ successful: true });
			return;
		}

		else if ( request.method == "[AutomaticTabCleaner:popupQuery]" )
		{
			if(debug)
				console.log('popupQuery Requested.');

			var tabURLAllowedForPark = isTabURLAllowedForPark(request.tab);
			var parked;
			try {
				parked = tabs[request.tab.id].parked;
			} catch(e) {}

			if(debug)
				console.log('Park alowed: '+tabURLAllowedForPark, 'parked: ',parked==true ,request.tab);
			sendResponse({
				successful: true,
				allowed: tabURLAllowedForPark,
				timeout: settings.get('timeout'),
				parked: parked==true,
				pauseTics: pauseTics,
				pauseTicsStartedFrom:
				pauseTicsStartedFrom,
				isTabInIgnoreTabList: isTabInIgnoreTabList(request.tab.id),
				isTabInWhiteList: whiteList.isURIException(request.tab.url),
				isCloseTabsOn: settings.get('isCloseTabsOn'),
				closeTimeout: settings.get('closeTimeout'),
				limitOfOpenedTabs: settings.get('limitOfOpenedTabs')
			});
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:updateTimeout]" )
		{
			if(request.timeout != null && typeof request.timeout == "number")
				settings.set('timeout', request.timeout);
			else if(request.isCloseTabsOn != null)
				settings.set('isCloseTabsOn', request.isCloseTabsOn);
			else if(request.closeTimeout != null && typeof request.closeTimeout == "number")
				settings.set('closeTimeout', request.closeTimeout);
			else if(request.limitOfOpenedTabs != null && typeof request.limitOfOpenedTabs == "number")
				settings.set('limitOfOpenedTabs', request.limitOfOpenedTabs);

			reloadSettings();

			sendResponse({ successful: true });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:uriExceptionCheck]" )
		{
			sendResponse({ isException: whiteList.isURIException(request.uri) });
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:TabChangedRequestFromInject]")
		{
			captureTab(sender.tab);
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:TabUnsuspended]")
		{
            getTabInfo(sender.tab).time = 0; //tabs[sender.tab.id].time = 0;
            getTabInfo(sender.tab).suspended_time = 0; //tabs[sender.tab.id].suspended_time = 0;
            getTabInfo(sender.tab).parkTrys = 0;
            formRestoreController.expectRestore(sender.tab.id, request.targetTabId, request.url);
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:getParkHistory]" )
		{
			sendResponse({parkHistory: parkHistory, closeHistory: closeHistory});
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:hideDialog]" )
		{
			hideWhiteListDialod(sender.tab.id);
            sendResponse({tabId: sender.tab.id});
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:addToWhiteList]" )
		{
			whiteList.addPattern(request.pattern);
			if(request.hideDialog == true)
				hideWhiteListDialod(sender.tab.id, {goBack: true});
			reloadSettings();

			setTimeout(function() {
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
			}, 500);

            sendResponse({tabId: sender.tab.id});

			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:removeUrlFromWhitelist]" )
		{
			removeUrlFromWhitelist( request.url );
			return;
		}
		else if ( request.method == "[AutomaticTabCleaner:donate]" )
		{
			google.payments.inapp.buy({
			  'parameters': {'env': 'prod'},
			  'sku': "ts_user_donation_level_4",
			  'success': console.log, //Object checkoutOrderId :"10370910874874185126.c70808e1b52d4fe5b71cb3c16f4a3f20"
			  'failure': console.log
			});
		}
        else if( request.method === "[AutomaticTabCleaner:getFormRestoreDataAndRemove]" )
        {
            //sendResponse({'formData': localStorage.getItem('f_t'+sender.tab.id)});
            //localStorage.removeItem('f_t'+sender.tab.id);
            sendResponse(formRestoreController.getFormRestoreDataAndRemove(sender.tab.id));
        }
        else if( request.method === "[AutomaticTabCleaner:DiscardTab]" )
        {
			//console.log("Dsicard: "+sender.tab.url);
            discardTab(sender.tab.id);
        }
        else if( request.method === "[AutomaticTabCleaner:UnmarkPageAsNonCompleteInput]" )
		{
            getTabInfo(sender.tab).nonCmpltInput = false;
		}
        else if( request.method === "[AutomaticTabCleaner:MarkPageAsNonCompleteInput]" )
        {
            getTabInfo(sender.tab).nonCmpltInput = true;
        }
	});

	function removeUrlFromWhitelist(url)
	{
		if(url != null )
		{
			whiteList.removePatternsAffectUrl(url);
			reloadSettings();

			setTimeout(function() {
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
			}, 500);
		}
	}

	function hideWhiteListDialod(tabId, options)
	{
		t5.sendMessage(tabId, {method: "[AutomaticTabCleaner:hideDialogRequetToTab]", options: options});
	}

	function tabExist (windows, tabId){
		"use strict";

		for (var i in windows)
			if (windows.hasOwnProperty(i))
				for (var j in windows[i].tabs)
					if (windows[i].tabs.hasOwnProperty(j))
						if(windows[i].tabs[j].id == tabId)
							return windows[i].tabs[j];
		return null;
	}

	function getTextWidth(text)
	{
		"use strict";

		var span = document.createElement('span');
		span.style.whiteSpace = "nowrap";
		span.style.fontFamily = "initial";
		span.style.fontSize = "initial";
		span.textContent = text;
		document.getElementsByTagName("body")[0].appendChild(span);
		var offsetWidth = span.offsetWidth;
        span.remove();
		return offsetWidth;
	}

	function createSecondLevelMenu( menuId, commands, menuInfosArray )
	{
		"use strict";

		var idsMap = {};
		var commandMap = {};
		var menuSpaceWidth = getTextWidth("a a")-getTextWidth("aa");
		var maxMenuLen = 0;

		for(var j in menuInfosArray)
		{
			if(menuInfosArray[j].type == null || menuInfosArray[j].type !== 'hidden')
            {
                menuInfosArray[j]._width = getTextWidth(menuInfosArray[j].title);
                if (menuInfosArray[j]._width > maxMenuLen)
                    maxMenuLen = menuInfosArray[j]._width;
            }
		}

		var constantSpaces = maxMenuLen * 0.33;

		for(var j in menuInfosArray)
		{
			var missingSpaces = (maxMenuLen-menuInfosArray[j]._width)/menuSpaceWidth;

			for(var k = 0; k< missingSpaces; k++ )
				menuInfosArray[j].title+=" ";

			for(var k = 0; k< constantSpaces/menuSpaceWidth; k++ )
				menuInfosArray[j].title+=" ";

			if(menuInfosArray[j]._command != null)
			{
				for(var i in commands)
				{
					if(commands[i] == null || commands[i].name == null)
						continue;

					if(commands[i].name == menuInfosArray[j]._command)
						menuInfosArray[j].title += commands[i].shortcut;
				}

				commandMap[menuInfosArray[j]._command] = menuInfosArray[j].onclick;

				delete menuInfosArray[j]['_command'];
			}

			if(menuInfosArray[j]._width != null)
				delete menuInfosArray[j]['_width'];

            if(menuInfosArray[j].type == null || menuInfosArray[j].type !== 'hidden')
            {
                var id = chrome.contextMenus.create(menuInfosArray[j]);

                if (menuInfosArray[j].id != null)
                    idsMap[menuInfosArray[j].id] = id;
            }
		}

		chrome.commands.onCommand.addListener(function(command) {
			if(debug)
				console.log('Command:', command);

			if(commandMap[command] != null)
			{
				chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
					if(tabs.length > 0 && tabs[0] != null)
						commandMap[command](null, tabs[0]);
				});
			}
		});

		return idsMap;
	}

	function winsowsCompare(a,b)
	{
		"use strict";

		if (a.id < b.id)
			return -1;
		else if (a.id > b.id)
			return 1;
		else
			return 0;
	}

	var oldToNewWindowsMap = {};

	/*function mapOldWindowsWithCurrent(lastTabsArray, wins)
	{
		"use strict";

		oldToNewWindowsMap = {};
		if(lastTabsArray != null && typeof lastTabsArray == "object" && Object.keys(lastTabsArray).length > 0)
			for (var k in lastTabsArray)
				if (lastTabsArray.hasOwnProperty(k))
					oldToNewWindowsMap[lastTabsArray[k].winId] = null;

		var sortedWins = wins.sort();

		var i = 0;
		for (var key in oldToNewWindowsMap)
			if (oldToNewWindowsMap.hasOwnProperty(key))
			{
				if(sortedWins[i] != null)
					oldToNewWindowsMap[key] = sortedWins[i].id
				else
					oldToNewWindowsMap[key] = sortedWins[0].id;
				i++;
			}
	}*/

	function getTargetUrlFromStoredTabsInfoObject(tabsInfoObject)
	{
		"use strict";

		return (tabsInfoObject.lstCapUrl != null ? tabsInfoObject.lstCapUrl : /* legacy */ tabsInfoObject.lastCapturedUrl);
	}

	function  isUrlAlreadyExistInWindow (wins, url, windId)
	{
		"use strict";

		//console.log("\n\nChecking "+ url+" for duplicates.");

		for (var i in wins)
			if (wins.hasOwnProperty(i))
				if(wins[i].id == windId)
					for (var j in wins[i].tabs)
						if (wins[i].tabs.hasOwnProperty(j))
						{
							//console.log(extUrl + "  VS  " + wins[i].tabs[j].url);
							if(wins[i].tabs[j].url == url)
							{
								//console.log("TRUE: " + wins[i].tabs[j].url);
								return true;
							}

							if(wins[i].tabs[j].url.indexOf(extUrl) == 0)
							{

								var parkedUrl = getParameterByName("url",wins[i].tabs[j].url);
								//console.log("Parked: "+ parkedUrl);
								if(parkedUrl != '' && parkedUrl != null)
									if(parkedUrl == url)
									{
										//console.log("TRUE: " + wins[i].tabs[j].url);
										return true;
									}
							}
						}
		//console.log("FLASE: " + url);
		return false;
	}

	function getNewWindowIdByOld(oldWindowId)
	{
		"use strict";

		return oldToNewWindowsMap[oldWindowId];
	}

	function getParameterByName(name, url)
	{
		"use strict";

		if (!url) url = window.location.href;
		name = name.replace(/[\[\]]/g, "\\$&");
		var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
			results = regex.exec(url);
		if (!results) return null;
		if (!results[2]) return '';
		return decodeURIComponent(results[2].replace(/\+/g, " "));
	}

	chrome.notifications.onClicked.addListener(function(id){
		chrome.notifications.clear(id);
	});


    /*chrome.webRequest.onErrorOccurred.addListener(function (details){
		console.log(details.error);
	});*/

    /*chrome.sessions.onChanged.addListener(function (change){
        console.warn('session.onChange:', change);
	});*/

	chrome.windows.onCreated.addListener(function() {
		tick(true);
	});

	// Events
	// tabs.onCreated - add to list
	t5.onCreated.addListener(function (tab) {
		//console.warn('onCreated:', tab);

		//if(isTabURLAllowedForPark(windows[i].tabs[j]))
		tabs[tab.id] = createNewTabInfo(tab);

		if(tab.autoDiscardable == true)
			t5.update(tab.id, {autoDiscardable: false});

        historyOpenerController.onNewTab(tab);

        if(tab.active == false)
            if(settings.get('openUnfocusedTabDiscarded') == true)
            {
                //discardTab(tab.id);
                //tabs[tab.id].discarded = true;
                tabs[tab.id].markedForDiscard = true;
            }
	});

	// tabs.onRemoved - load if unloaded, remove from list
	t5.onRemoved.addListener(function (tabId, info) {
		"use strict";

		var i;
		for (i in tabs) {
			if (tabs.hasOwnProperty(i) && i == tabId) {
				var parked = tabs[i].parked;
				delete tabs[i];
				removeScreen(i);

				if(parked == true)
					storeTabs (tabs);

				break;
			}
		}

        historyOpenerController.onRemoveTab(tabId);
	});

	window.isTabParked = function (tab){
		"use strict";

		return tab.url.substring(0, tab.url.indexOf('?')) === extUrl;
	}

	// tabs.onSelectionChanged - load if unloaded, reset inactivity
	t5.onActivated.addListener(function (activeInfo) {
		"use strict";

        //console.log("onActivated");

		var i;
		t5.get(activeInfo.tabId, function (tab) {

			/*if(tab.discarded == true && isTabParked(tab) && getScreenCache == null)
				try
				{
					var sessionId = parseUrlParam(tab.url, 'sessionId');
					var tabId = parseUrlParam(tab.url, 'tabId');
					if(sessionId != null && tabId != null)
					{
						//t5.reload(activeInfo.tabId);
						getScreenCache = {
							sessionId: sessionId,
							tabId: tabId,
							getScreenPromise: new Promise(function(resolve, reject) {
								getScreen(tabId, sessionId, function (screen)
								{
									if(getScreenCache != null)
									{
										getScreenCache.screen = screen;
										resolve();
										console.log("Screen cached.");
									}
									else
										console.log("Screen cache outdated!");
								});
							})
						};
					}
				}
				catch(e)
				{

				}*/

			getTabInfo(tab).swch_cnt++;
			getTabInfo(tab).time = 0;
			getTabInfo(tab).active_time += tickSize * (isAudiable(tab) ? 1.5 : 1);
			getTabInfo(tab).suspended_time = 0;
			getTabInfo(tab).parkTrys = 0;

            try
            {
                if (isTabParked(tab))
                {
                    if (settings.get('autoRestoreTab'))
                        unsuspendTab(tab); //c5.runtime.sendMessage({'method': "[AutomaticTabCleaner:RestoreMessage]", 'tab': tab});
                }
                else if (!tab.discarded && settings.get('animateTabIconSuspendTimeout'))
                    t5.sendMessage(activeInfo.tabId, {
                        method: "[AutomaticTabCleaner:highliteFavicon]",
                        highliteInfo: {suspendPercent: 0}
                    });
            }
            catch(e)
			{
				console.error(e);
			}

			try
            {
                if (/*isTabURLAllowedForPark(tab) &&*/ !isTabParked(tab) && tab.url.indexOf(sessionsPageUrl) == -1)
                {
                    //captureTab(tab);
                    if (!tab.discarded)
                        (function (closureTab)
                        {
                            setTimeout(function ()
                            {
                                captureTab(closureTab, {checkActiveTabNotChanged: true});
                            }, 400);
                        })(tab);

                    if (tabs[tab.id] != null)
                        tabs[tab.id].lstSwchTime = Date.now();
                }
            }
            catch (e)
			{
				console.error(e);
			}

			try
			{
				if (tab.url.indexOf(sessionsPageUrl) == 0)
					chrome.tabs.sendMessage(tab.id, {'method': "[AutomaticTabCleaner:updateSessions]"});
			} catch (e) {
				console.error(e);
			}

			/* Change Icon to green */
			new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).updateStatus(tab);
		});

		/*for (i in tabs) {
			if (tabs.hasOwnProperty(i) && i == activeInfo.tabId) {
				tabs[i].time = 0;
				break;
			}
		}*/
		/*if(tabs[activeInfo.tabId] != null)
        {
            tabs[activeInfo.tabId].time = 0;
            tabs[activeInfo.tabId].active_time += tickSize * (isAudiable(windows[i].tabs[j]) ? 1.5 : 1);
            tabs[activeInfo.tabId].suspended_time = 0;
            tabs[activeInfo.tabId].parkTrys = 0;
        }*/
	});

	/*e5.onRequest.addListener(function(request, sender, sendResponse) {
	  if (request.method === "getHTML") {
		if(debug)
			console.log(request.data);
	  }
	});*/

	t5.onUpdated.addListener(function(tabId, changeInfo, tab) {
		"use strict";

        //console.log("Tab Updated: "+Date.now()+" "+tab.active, changeInfo);

        if(changeInfo.discarded == false && tab.active == true && isTabParked(tab) && getScreenCache == null)
			try
			{
				var sessionId = parseUrlParam(tab.url, 'sessionId');
				var tabId = parseUrlParam(tab.url, 'tabId');
				if(sessionId != null && tabId != null)
				{
					//t5.reload(activeInfo.tabId);
					getScreenCache = {
						sessionId: sessionId,
						tabId: tabId,
						getScreenPromise: new Promise(function(resolve, reject) {
							getScreen(tabId, sessionId, function (screen, pixRat)
							{
								if(getScreenCache != null)
								{
									getScreenCache.screen = screen;
                                    getScreenCache.pixRat = pixRat;
									resolve();
									if(debugScreenCache)
										console.log("Screen cached.");
								}
								else
                                {
                                    if(debugScreenCache)
                                    	console.log("Screen cache outdated!");
                                }
							});
						})
					};
				}
			}
			catch(e)
			{

			}

		getTabInfo(tab);

        try
        {
            if (tab.active == false && tab.status === "loading")
            {
                //console.log("Discarding Tab: tab !active");

                if (tabs[tab.id].markedForDiscard == true)
                {
                    //console.log("Discarding Tab: tab marked for discard");
                    if (tab.favIconUrl != null && tab.title != null && tab.title != tab.url)
                    {
                        console.log("Discarding Tab: ", tab.url);
                        discardTab(tab.id);
                        tabs[tab.id].discarded = true;
                    }
                }
            }
        }
        catch (e)
        {
            console.error(e);
        }

		if(debug && Object.keys(changeInfo).length == 1 && Object.keys(changeInfo)[0] == "title")
			return;

		if(Object.keys(changeInfo).length == 1 && Object.keys(changeInfo)[0] == "favIconUrl")
			return;

		var captured = false;

		if (changeInfo.status === "complete")
		{
			if(debug)
				console.log("Tab Updated", tab);

            getTabInfo(tab).nonCmpltInput = false;

			if(tab.active == true)
			{
				if(isTabURLAllowedForPark(tab))
				{
                    setTimeout(function() {captureTab(tab);}, 150);
					captured = true;
				}

				/* Change Icon to green */
				new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).updateStatus(tab);
			}

            if(isTabParked(tab))
				t5.getZoom(tab.id, function (zoomFactor){
					if(zoomFactor != 1.0)
						t5.setZoom(tab.id, 1.0);
				});
        }

		//if (tabs.hasOwnProperty(tab.id))
		//{

		if(changeInfo.url != null)
        {
        	//console.log("tabUpdated: ", changeInfo, getTabInfo(tab));

        	if(getTabInfo(tab).parkedUrl != null &&
                getTabInfo(tab).parkedUrl != changeInfo.url)
				if( !(changeInfo.url.indexOf(extUrl) == 0 && getTabInfo(tab).parkedUrl.indexOf(extUrl) < 0 ) )
                {
                	//console.warn('parkedUrl => null');
                    getTabInfo(tab).parkedUrl = null;
                }
        }

		if(isTabParked(tab))
		{
            getTabInfo(tab).parked = true;
			if(changeInfo.discarded != null && changeInfo.discarded==false)
                getTabInfo(tab).discarded = false;
		}
		else
		{
            getTabInfo(tab).parked = false;

			if(tab.active == true)
				if(!captured && changeInfo.status != "loading")
					setTimeout(function() {captureTab(tab);}, 150);
		}

		//}

		//historyOpenerController.onTabUpdate(tabId, changeInfo);
	});

    t5.onReplaced.addListener(function(addedTabId, removedTabId){
    	//console.log('onReplaced: ', addedTabId, removedTabId);
		//tabIdRegistry[removedTabId] = addedTabId;

        tabs[addedTabId] = tabs[removedTabId];
        tabs[addedTabId].id = addedTabId;
        delete tabs[removedTabId];
	});

    /*var tabIdRegistry = {};
    window.findCurrentTabId = function (originalTabId){
		if(tabIdRegistry[originalTabId] != null)
			return findCurrentTabId(tabIdRegistry[originalTabId]);
		else
			return originalTabId;
	}*/

	// ReloadSettingsListener
    //r5.onMessage.addListener(function(request, sender, sendResponse) {
	//FIREFOX support e5.onRequest.addListener(function(request, sender, sendResponse) {
	e5.onRequest.addListener(function(request, sender, sendResponse)
	{
	  if (request.method === "[AutomaticTabCleaner:ReloadSettings]")
	  {
	//window.reloadSettingsEvent = function()
	//{
		if(debug)
			console.log(request.method);
			//TODO: !!!!!!!!!
		reloadSettings({fromSettingsPage: true});
	//}
	  }
	  else if(request.method === '[AutomaticTabCleaner:resetAllSettings]')
	  {
	  	settings.removeAll();
	  	settings = new Store(settingsStorageNamespace, DEFAULT_SETTINGS);
	  	reloadSettings(/*{fromSettingsPage: true}*/);
	  }
	});



	chrome.runtime.setUninstallURL("https://uninstall.tab-suspender.com/"
	/*"https://docs.google.com/forms/d/e/1FAIpQLScwoXFs-XpYtbEkW-TvnApdGVmjqdITMVCe7baSjA6bBbmWuw/viewform"*/, null);

	/*
	 * STARTUP/UPDATE
	 */


	var restoreTabOnStartup_TemporarlyEnabel = false;
	var menuId;

	// init function
	/**
	 *
	 */
	function init(options) {
		"use strict";

		//if(debug)
			console.log("Started at " + new Date() + " with restoreTabOnStartup_TemporarlyEnabel="+restoreTabOnStartup_TemporarlyEnabel);

        screenshotQuality = settings.get('screenshotQuality');

		try
		{
			navigator.getBattery().then(function(battery) {
				battery.onchargingchange = function(event){
					isCharging = event.target.charging;
					console.log('Charging: '+event.target.charging);
				};
				console.log('Startup Charging: '+battery.charging);
				isCharging = battery.charging;
			});
		}
		catch (e)
		{
			console.log("navigator.getBattery() does not support by browser!");
		}

		if(menuId == null)
			chrome.commands.getAll(function (commands){
				if(debug)
					console.log("Commands:", commands);

				menuId = chrome.contextMenus.create({
					title: "Tab Suspender",
					contexts:["all"],  // ContextType
					onclick: null // A callback function
				});
				/*var menuWhitelistId = chrome.contextMenus.create({
					title: "White List",
					contexts:["all"],
					onclick: null,
					parentId: menuId
				});*/

				if(debug)
					console.log("Menu id", menuId);

				globalMenuIdMap = createSecondLevelMenu (menuId, commands, [
					{
						type: 'checkbox',
						id: "add_to_white_list",
						title: "Add to Whitelist...",
						contexts: ["all"],
						onclick: function(info, tab) {
							if(info == null || info.checked) {
								if(!whiteList.isURIException(tab.url))
                                {
                                    t5.sendMessage(tab.id, {method: "[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]"});
                                    new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
                                }
                            }
							else
                                removeUrlFromWhitelist(tab.url);
                        },
						parentId: menuId,
						documentUrlPatterns: ["http://*/*","https://*/*"],
						_command: 'add-to-white-list'
					},
					{
						type: 'hidden',
						id: "remove_from_white_list",
						title: "Remove from Whitelist",
						contexts: ["all"],
						onclick: function(info, tab){ removeUrlFromWhitelist(tab.url); },
						parentId: menuId,
						documentUrlPatterns: ["http://*/*","https://*/*"],
						/*enabled: false*/
						_command: 'remove-from-white-list'
					},
					{
                        type: "separator",
                        title: "Whitelist separator",
                        contexts: ["all"],
                        parentId: menuId,
                        documentUrlPatterns: ["http://*/*","https://*/*"]
					},
					{
						title: "Suspend Current",
						contexts:["all"],
						onclick: function(info, tab){
							//_captureTab(tab).then(function(){
							parkTab(tab, tab.id);
							//},function () {
							//parkTab(tab, tab.id);
							//});
						},
						parentId: menuId,
						documentUrlPatterns: ["http://*/*","https://*/*"],
						_command: 'suspend-current'
					},
					{
						title: "Suspend All",
						contexts:["all"],
						onclick: function(info, tab){parkTabs(null);},
						parentId: menuId
					//_command: 'suspend-all'
					},
					{
						title: "Suspend All Other",
						contexts:["all"],
						onclick: function(info, tab){parkTabs(tab);},
						parentId: menuId,
						documentUrlPatterns: ["http://*/*","https://*/*"],
						_command: 'suspend-all-other'
					},
					{
						title: "Suspend Window",
						contexts:["all"],
						onclick: function(info, tab){parkTabs(tab, tab.windowId);},
						parentId: menuId,
						_command: 'suspend-all-window'
					},
					{
						title: "Unsuspend All Tabs",
						contexts:["all"],
						onclick: function(info, tab){unsuspendTabs(); },
						parentId: menuId,
						_command: 'unsuspend-all-tabs'
					},
					{
						title: "Unsuspend Window",
						contexts:["all"],
						onclick: function(info, tab){unsuspendTabs(tab.windowId);},
						parentId: menuId,
						_command: 'unsuspend-current-window'
					},
					{
						title: "Unsuspend Current Tab",
						contexts:["all"],
						onclick: function(info, tab){unsuspendTab(tab);},
						parentId: menuId,
						_command: 'unsuspend-current-tab',
						documentUrlPatterns: [extUrl+"**"]
					},
                    {
                        type: "separator",
                        title: "Whitelist separator",
                        contexts: ["all"],
                        parentId: menuId,
                        documentUrlPatterns: ["http://*/*","https://*/*"]
                    },
					{
                        type: 'checkbox',
						title: "Ignore Current Tab",
						contexts:["all"],
						onclick: function(info, tab){if(info == null || info.checked) {addToIgnoreTabList(tab.id);} else {removeFromIgnoreTabList(tab.id);}},
						parentId: menuId,
						id: 'ignore-current-tab',
						_command: 'ignore-current-tab',
						documentUrlPatterns: ["http://*/*","https://*/*"]
					}/*,
                    {
                        title: "Remove Current Tab from Ignore",
                        contexts:["all"],
                        onclick: function(info, tab){removeFromIgnoreTabList(tab.id);},
                        parentId: menuId,
						id: 'remove-current-tab-from-ignore',
                        _command: 'remove-current-tab-from-ignore',
                        documentUrlPatterns: [_____________],
                    }*/,
                    {
                    	type: 'hidden',
                        contexts:["all"],
                        title: "Suspend or Unsuspend Current Tab (in one HotKey)",
                        parentId: menuId,
                        onclick: function(info, tab){if(!tab.url.startsWith(extUrl)){parkTab(tab, tab.id);} else {unsuspendTab(tab);} },
                        _command: 'suspend-or-unsuspend-current-tab'
                    },
                    {
                        type: "separator",
                        title: "Whitelist separator",
                        contexts: ["all"],
                        parentId: menuId,
                        documentUrlPatterns: ["http://*/*","https://*/*"]
                    },
					{
						title: "Change Hotkeys...",
						contexts:["all"],
						onclick: function(info, tab){chrome.tabs.create({'url': 'chrome://extensions/configureCommands'}, function(tab) {}); },
						parentId: menuId
					}
				]);
			});


		var restoreTabOnStartup = settings.get('restoreTabOnStartup') || restoreTabOnStartup_TemporarlyEnabel;

		whiteList = new WhiteList(settings);

		var openedIndex = 1;

		/*var lastTabsArray;
		try {
			lastTabsArray = JSON.parse(localStorage.getItem('tabsInfo'));
		}
		catch (e)
		{
			console.error("Exception while restore previous session:", e);
		}*/

		// get all windows with tabs
		c5.windows.getAll({"populate": true}, function (wins) {
			"use strict";

			//console.log('Started Tabs: ', wins[0].tabs);

			try
			{

				/*mapOldWindowsWithCurrent(lastTabsArray, wins);

				var restoreTabFromLstSession = function (//windowId, restoreToWindowId
															){
					var k;
					var restored = [];

					if(lastTabsArray != null && typeof lastTabsArray == "object" && Object.keys(lastTabsArray).length > 0)
						for (k in lastTabsArray)//for(var k=0; k < Object.keys(lastTabsArray).length;k++)
							if (lastTabsArray.hasOwnProperty(k)){
								if(! isUrlAlreadyExistInWindow(wins, getTargetUrlFromStoredTabsInfoObject(lastTabsArray[k]),getNewWindowIdByOld(lastTabsArray[k].winId))){//if(lastTabsArray[k].winId == windowId || windowId == null){
									if(lastTabsArray[k].lstCapUrl != null ||
										// legacy
										lastTabsArray[k].lastCapturedUrl != null){
										if(lastTabsArray[k].v == 2 && lastTabsArray[k].parked == true ||
											// legacy
											lastTabsArray[k].v == null && lastTabsArray[k].parkTrys > 0){
											var tmpFunction = function (clzObjArg, clzOpenedIndexArg){
												"use strict";

												var clzObj = clzObjArg;//lastTabsArray[k];
												var clzOpenedIndex = clzOpenedIndexArg;//openedIndex++;
												var clzRestoreToWindowId = getNewWindowIdByOld(clzObj.winId);//restoreToWindowId;
												//var clzWindowId = windowId;

												if(debug)
													console.log("Prepare for creation tab:" + getTargetUrlFromStoredTabsInfoObject(clzObj));
												setTimeout(function (){
													if(debug)
														console.log("Creation tab: " + getTargetUrlFromStoredTabsInfoObject(clzObj));
													t5.create({
														windowId: clzRestoreToWindowId,
														index: (clzRestoreToWindowId != null ? clzObj.index : null),
														url: getTargetUrlFromStoredTabsInfoObject(clzObj)//(clzObj.lstCapUrl != null ? clzObj.lstCapUrl :  clzObj.lastCapturedUrl) //legacy
													}, null);
												},50*clzOpenedIndex);
											}
											tmpFunction(lastTabsArray[k], openedIndex++);
											restored.push(k); //delete lastTabsArray[k];
										}
										else
										{
											if(debug)
												console.log(4, lastTabsArray[k]);
										}
									}
									else
									{
										if(debug)
											console.log(3, lastTabsArray[k]);
									}
								}
								else
								{
									if(debug)
										console.log(2, lastTabsArray[k]);
								}
							}
							else
							{
								if(debug)
									console.log(1, lastTabsArray[k]);
							}

					if(restored.length > 0)
						for(var i=0;i<restored.length;i++){
							if (lastTabsArray.hasOwnProperty(restored[i]))
								delete lastTabsArray[restored[i]];
						}
				}*/


				var i, j, id, firstWindow;
				// get all tabs, init array with 0 inactive time
				for (i in wins) {
					if (wins.hasOwnProperty(i)) {
						if(firstWindow == null)
							firstWindow = wins[i].id;

						for (j in wins[i].tabs) {
							if (wins[i].tabs.hasOwnProperty(j)) {
								id = wins[i].tabs[j].id;

								/* TURN OFF AUTODISCARTABLE */
                                if(wins[i].tabs[j].autoDiscardable == true)
                                    t5.update(id, {autoDiscardable: false});

                                // HISTORY SUPPORT LOGIC
                                historyOpenerController.collectInitialTabState(wins[i].tabs[j]);

								if(options==null || options.reloadSettings == null || options.reloadSettings == false)
									if(isTabURLAllowedForPark(wins[i].tabs[j]) && wins[i].tabs[j].url.indexOf('https://chrome.google.com/webstore') < 0 && wins[i].tabs[j].discarded == false)
										injectJS(id);

								/* COLLECT TABS INFO */
								if(tabs[id] == null)
									tabs[id] = createNewTabInfo(wins[i].tabs[j]);
								else
								{
									//tabs[id].id = id;
									//tabs[id].time = 0;
									//tabs[id].active_time = 0;
									//tabs[id].swch_cnt = 0;*/
								}

								/*c5.pageAction.show(wins[i].tabs[j].id);
								if(wins[i].tabs[j].url.indexOf(e5.getURL('/')) == 0)
									c5.pageAction.setIcon({path: "/img/icon16_off.png", tabId: wins[i].tabs[j].id});*/
							}
						}

						/* Restore Last Session for current Window */
						//if(restoreTabOnStartup && (options == null || options.reloadSettings == null))
						//	restoreTabFromLstSession(/*wins[i].id, wins[i].id*/);
					}
				}

				/* Restore Last Session for dissapired window */
				//if(restoreTabOnStartup && (options == null || options.reloadSettings == null))
				//	restoreTabFromLstSession(/*null, firstWindow*/);

				// Cleanup storage
				//localStorage.setItem('tabsInfo', '{}');
			}
			catch (e)
			{
				console.error("Exception while restoreTabFromLstSession:", e);
			}

			/* Restore parkHistory */
			try
			{
				parkHistory = JSON.parse(localStorage.getItem('parkHistory'));
				if(!Array.isArray(parkHistory))
					parkHistory = [];
			}
			catch (e)
			{
				console.error("Exception while restore previous parkHistory:", e);
			}

			/* Restore closeHistory */
			try
			{
				closeHistory = JSON.parse(localStorage.getItem('closeHistory'));
				if(!Array.isArray(closeHistory))
					closeHistory = [];
			}
			catch (e)
			{
				console.error("Exception while restore previous closeHistory:", e);
			}

			// bind events
			//tick();
			//ticker = setInterval(tick, tickSize * 1000);
			//change icon
			/*try
			{
				if(c5.browserAction !=null)
					c5.browserAction.setIcon({'path': 'img/icon16.png'});
			}
			catch (e)
			{
				//debugger;
			}*/

			/*
			 * TODO: WIZARD: ADD IF FOR IS IT FIRAST INSTALL OR UPDATE ONLY!!!
			 */
			/*try
			{
                drawSetupWizardDialog();
			}
			catch (e)
			{}*/
		});

		/**/
		//c5.permissions.request( {permissions: ["unlimitedStorage"] }, function () {console.log("Permission Ok!");})
		/**/
	}

	/**
	 *
	 */
	r5.onUpdateAvailable.addListener(function(details){
		console.log('Update available.. '+(details ? details.version : 'no version info.'));
	});


	var expectedInjectExceptions = ['The tab was closed.',
		'The extensions gallery cannot be scripted.',
		//'Cannot access contents of url "chrome-error://chromewebdata/". Extension manifest must request permission to access this host.',
        'RegExp:Cannot access contents of url "(?!(https?://[^"]{5,}))',
		'RegExp:Cannot access contents of url "https://www.google.[^/]+/_/chrome/newtab'];
    function injectJS(tabId)
	{
        "use strict";

		try
		{
            var closureId = tabId;
            t5.executeScript(closureId, {file: "lib/h2c.js"}, function (fff) {
                hasLastError(expectedInjectExceptions);

                if (debug && debugInit) {
                    console.log(closureId);
                }
                t5.executeScript(closureId, {file: "inject.js"}, function (a){
                    hasLastError(expectedInjectExceptions);
				});
            });
        }
        catch (e)
		{
			console.error("injectJS exception", e);
		}
    }

	/**
	 *
	 */
	r5.onInstalled.addListener(function(details){

		if(debug)
			console.log("Installed at " + new Date().getTime());

		if(details.reason == "install")
		{
			if(debug)
				console.log("This is a first install!");
		}
		else if(details.reason == "update")
		{
			var thisVersion = chrome.runtime.getManifest().version;
			console.log("Updated from " + details.previousVersion + " to " + thisVersion + "!"); /* Updated from 0.4.8.3 to 0.4.8.4! */


			/************* PATCHES: ********************************
			 * TODO: remove this variable after migration complete!!!
			 *******************************************************/
			/* PATCH #1 */
			if(versionCompare(details.previousVersion, '0.4.8.2') < 0)
				restoreTabOnStartup_TemporarlyEnabel = true;

            settingsInitedPromise.then(function () {
				/* PATCH #2 */
            	if(versionCompare(details.previousVersion, '1.3.2.3') < 0) {
                	console.log('Disabling "animateTabIconSuspendTimeout" for versions less then 1.3.2.3...');
                    settings.set('animateTabIconSuspendTimeout', false);
                }
				/* PATCH #3 */
                if(versionCompare(details.previousVersion, '1.3.2.4') < 0) {
                	if(settings.get('screenshotQuality') == 100)
                        settings.set('screenshotQuality', 90);
                }
			});
		}
	});

	/**
	 *
	 */
	function reloadSettings(options){
		if (ticker) {
			clearInterval(ticker);
			ticker = null;
		}

		/* STORE TABS STATE */
		tick(true);

		preInit({reloadSettings: true});

		if(!options || !options.fromSettingsPage)
			reloadSettingsPage();

		r5.sendMessage({'method': "[AutomaticTabCleaner:UpdateTabsSettings]",
			'restoreEvent': window.getRestoreEvent(),
			'reloadTabOnRestore': window.getReloadTabOnRestore(),
			'parkBgColor': window.getParkBgColor(),
			'screenshotCssStyle': window.getScreenshotCssStyle(),
			'restoreButtonView': window.getRestoreButtonView()
		});
	}

	/**
	 *
	 */
	function reloadSettingsPage() {
		var manifest = chrome.runtime.getManifest();
		var extviews = chrome.extension.getViews();
		var settingsPage = chrome.extension.getURL(manifest.options_page);

		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href == settingsPage) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id, {});
				});
				break;
			}
		}
	};

	/**
	 *
	 */
	function reloadHistoryPage() {
		var manifest = chrome.runtime.getManifest();
		var extviews = chrome.extension.getViews();
		var settingsPage = chrome.extension.getURL('history.html');

		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href == settingsPage) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id, {});
				});
				break;
			}
		}
	};


	/**
	 *
     */
    function drawSetupWizardDialog ()
    {
        chrome.tabs.query({currentWindow: true, active: true}, function (tabs)
        {
            /*chrome.tabs.sendMessage(tabs[0].id, {
                'method': "[AutomaticTabCleaner:DrawSetupWizardDialog]",
                'tab': tabs[0]
            }, function (res)
            {  });*/
            t5.create({
				'windowId': tabs[0].windowId,
				'index': tabs[0].index+1,
				'url': e5.getURL('wizard_background.html'),
				'active': true
            })
        });
    }

    /**
	 *
     */
    var lastRow=-1;
    function copyWebSqlToIndexedDB ()
	{

	   var cleanAndCloseWebSql = function (){
		console.log("DB Moved From WebSql To IndexedDB !!!!!!!!!!!!!");

        dbMovedFromWebSqlToIndexedDB = true;
        localStorage.setItem('dbMovedFromWebSqlToIndexedDB', true);
        /* DELETE * FORM WEBSQL... */

		webSqlDatabase.executeDelete({
			WebSQL:
				{
					query: 'DROP TABLE screens',
					params: []
				}
		});

		webSqlDatabase = null;
		console.log("WebSqlDB removed && closed !!!!!!!!!!!!!");
	   };

        var copyFromWebSqlToIndexedDBOneByOne;
        copyFromWebSqlToIndexedDBOneByOne = function(offset)
        {
            webSqlDatabase.getAll({
                WebSQL:
                    {
                        query: 'select id, sessionId, added_on, screen from screens LIMIT '+offset+', 2',
                        params: null
                    }

            }, function (resultsRowsArray)
            {
                if(resultsRowsArray != null)
                {
                    //for(var i=0;i<resultsRowsArray.length;i++)
                    //{
                    var callPut = function(curI)
                    {
                        setTimeout(function () {

                            if(resultsRowsArray[curI]!= null)
                            {
                                var data =
                                    {
                                        'id': parseInt(resultsRowsArray[curI].id),
                                        'sessionId': resultsRowsArray[curI].sessionId,
                                        'added_on': resultsRowsArray[curI].added_on,
                                        'screen': resultsRowsArray[curI].screen
                                    };

                                database.put(
                                    {
                                        IDB:
                                            {
                                                table: 'screens',
                                                data: data
                                            }
                                    }
                                );
                            }

					   console.log("Moved "+curI+" from "+lastRow+" records.");

                            if(lastRow == offset)
	                            cleanAndCloseWebSql();

                        }, 1500 * offset);
                    }

                    callPut(0);
                    //}
                    if(resultsRowsArray.length > 1)
                        copyFromWebSqlToIndexedDBOneByOne(offset+1);
                    else
                        lastRow = offset;
                }
            },
		  function(e){
			console.log("Error when open WebSqlDB: ", e);
			console.log("Removing WebSqlDB...");
			cleanAndCloseWebSql();
		  });
        };

        copyFromWebSqlToIndexedDBOneByOne(0);
	}

	/**
	 *
	 */
	function cleanupDB()
	{
		console.log("DB Cleanup started...");
		//setTimeout(function(){
			//debugger;

			var usedSessionIds = {};

            t5.query({}, function (tabs) {
                for (var i in tabs)
                    if (tabs.hasOwnProperty(i))
                        if (tabs[i].url.indexOf(extUrl) == 0) {
                            var sessionId = parseUrlParam(tabs[i].url, 'sessionId');
                            if (sessionId != null)
                                usedSessionIds[sessionId] = true;
                        }

				usedSessionIds[parseInt(window.TSSessionId)] = true;
                usedSessionIds[parseInt(window.previousTSSessionId)] = true;

                /*database.readTransaction(function(tx) {
                    tx.executeSql(
                        'select sessionId from screens where sessionId NOT IN ("'+Object.keys(usedSessionIds).join('","')+'") group by sessionId', null,
                        function (t, results) {
                            var len = results.rows.length;
                            for(var i=0;i<len;i++)
                            {
                            	var callDelete = function(curI)
								{
                                    setTimeout(function () {
                                        database.transaction(function (tx) {
                                            console.log('Trying to delete session[' + curI + ', ' + results.rows.item(curI) + '] data')
                                            tx.executeSql(
                                                'delete from screens where sessionId = ?', [results.rows.item(curI).sessionId],
                                                function () {
                                                    //debugger;
                                                },
                                                sql_error);
                                        });
                                    }, 2000 * curI);
                                }

                                callDelete(i);
                            }
                        },
                        sql_error);
                }, sql_error, null);*/


                database.getAll({
					IDB:
						{
							table: 'screens',
							index: "PK",
							predicate: "getAllKeys",
							predicateResultLogic: function (result)
							{
								var filtredResult = [];
								var filterdSessionKeysArray = Object.keys(usedSessionIds);
								console.log(filterdSessionKeysArray);
								/* [sessionId NOT IN] IMPLEMENTATION */
                                		var isScreenActual;
			                         for(var i=0;i<result.length;i++)
			                         {
			                          	isScreenActual = false;
			                           	for (var j = 0; j < filterdSessionKeysArray.length; j++)
					                         if (result[i][1] == filterdSessionKeysArray[j])
					                         {
					                         	isScreenActual = true;
					                              break;
					                         }

			                          	if(!isScreenActual)
			                          		filtredResult.push(result[i]);
			                      	}

								return filtredResult;
							}
						},
					WebSQL:
						{
							query: 'select sessionId from screens where sessionId NOT IN ("'+Object.keys(usedSessionIds).join('","')+'") group by sessionId',
							params: null
						}

				}, function (resultsRowsArray)
				{
					if(resultsRowsArray != null)
						for(var i=0;i<resultsRowsArray.length;i++)
						{
							var callDelete = function(curI)
							{
								setTimeout(function () {

									database.executeDelete({
										IDB:
										{
                                            table: 'screens',
                                            index: 'PK',
											params: [resultsRowsArray[curI][0], resultsRowsArray[curI][1]]
										},
										WebSQL:
										{
											query: 'delete from screens where sessionId = ?',
											params: [resultsRowsArray[curI].sessionId]
										}
									});
								}, 2000 * curI);
							}

							callDelete(i);
						}
				});
            });


		var factor = new Date();
		factor.toString = function() {
		  this.on = true;
		}

		var interval = setInterval(function() {
			factor.info='!READ THIS!: Temporarly Marketing investigation for total active users of Tab Suspender. (will be removed after 2-3 weeks of research)';
			console.log('%c', factor);
			if(!factor.on)
				trackView('active_user');
			else {
				//console.log('clear int!');
				clearInterval(interval);
			}
		}, 1740*1000  /*30*1000*/);

		//}, DELAY_BEFORE_DB_CLEANUP)
	}


	/**
	 *
	 */
	function start() {
		"use strict";

		console.log(Copyright);

		if(debug)
			console.log('Starting...');

        trackErrors('background', false);

        /*try {
            tabs = JSON.parse(localStorage.getItem('tabsInfo'));
            console.log('Readed tabs[]: ', tabs);
        }
        catch (e)
        {
            console.error("Exception while restore previous session:", e);
        }*/

		startedAt = new Date().getTime();
		extUrl = e5.getURL('park.html');
		window.TSSessionId = Date.now();
        console.log("window.TSSessionId: ", window.TSSessionId);

		/* Save last session ID */
		console.log("window.previousTSSessionId: ", window.previousTSSessionId);
		window.previousTSSessionId = JSON.parse(localStorage.getItem('TSSessionId'));
        console.log("window.previousTSSessionId: ", window.previousTSSessionId);
        localStorage.setItem('TSSessionId', window.TSSessionId);

		/* Connect DB */
        database = new DBProvider("IndexedDB");

        dbMovedFromWebSqlToIndexedDB = JSON.parse(localStorage.getItem('dbMovedFromWebSqlToIndexedDB'));
        if(dbMovedFromWebSqlToIndexedDB != true)
        {
        	webSqlDatabase = new DBProvider("WebSQl", {skipSchemaCreation: true});
        	console.log("Moving to IndexedDB...");
        	setTimeout(function(){
            	database.getInitializedPromise().then(copyWebSqlToIndexedDB);
            }, DELAY_BEFORE_DB_MIGRATE_TO_INDEXEDDB);
        }
        else
            console.log("Already moved to IndexedDB.");

        setTimeout(cleanupDB, DELAY_BEFORE_DB_CLEANUP);


		var prepare = function ()
		{
			/* TODO: cleanup this logic after cleanup complete! */

			/* Prerare settings */
			var settingsOld = new Store('settings', DEFAULT_SETTINGS);
            var firstInstallation = ((new Store(settingsStorageNamespace).get('timeout')) == null && !chrome.extension.inIncognitoContext);
			settings = new Store(settingsStorageNamespace, DEFAULT_SETTINGS);
            settingsInitedResolve();

			/*
			 * TODO: WIZARD: ADD IF FOR IS IT FIRAST INSTALL OR UPDATE ONLY!!!
			 */
			try
			{
				if(firstInstallation)
                {
                    console.log("EX: Installed!");
                    drawSetupWizardDialog();
                    trackView('installed');
                }
				else
					console.log("EX: Updated!");
			}
			catch (e)
			{}

			if(settings.get('migratedFromOldSettings') == null)
			{
				for (var k in DEFAULT_SETTINGS)
					if (DEFAULT_SETTINGS.hasOwnProperty(k))
						settings.set(k, settingsOld.get(k));
				settings.set('migratedFromOldSettings', true);
			}

			window.TSSettingsInitialized = true;

			/* WILL BE INITALIZED 2 TIMES: HERE AND INSIDE INIT(..) TO RELOAD SETTINGS */
            whiteList = new WhiteList(settings);

			/* Discard tabs */
			//console.log("Discard loop..");
			//if()
				t5.query({active: false/*, discarded: false*/}, function (tabs){
					//console.log("Discard loop: tabs: ", tabs);
					var localExtUrl = extUrl;
					for (var i in tabs) {
						if (tabs.hasOwnProperty(i)) {


							if(tabs[i].url.indexOf(localExtUrl) == 0)
							{
								//if(tabs[i].discarded == true)
									if(tabs[i].url.startsWith(chrome.extension.getURL('park.html')))
										if(tabs[i].favIconUrl===null || tabs[i].favIconUrl=="")
										{
											//console.log("Wrong discarded: ", tabs[i].url, tabs[i],"Reload..");
											chrome.tabs.reload(tabs[i].id);
										}
							}

							if(tabs[i].url.indexOf(localExtUrl) == -1)
								if(settings.get('startNormalTabsDiscarted') == true)
									if(tabs[i].discarded == false)
										if(!isExceptionTab(tabs[i]))
											try
											{
												//console.log("Dsicard: "+tabs[i].url);
                                                discardTab(tabs[i].id);
											}
											catch(e)
											{
												console.error("Discard error", e);
											}

						}
					}
				});

			if(debug)
				setTimeout(preInit, 2000);
			else
				setTimeout(preInit, 1000);
		};

		/* Adjast DEFAULT_SETTINGS.limitOfOpenedTabs according of Screen size */
		if(chrome.hasOwnProperty('system') && chrome.system.hasOwnProperty('display'))
            try
            {
				chrome.system.display.getInfo(function(displayInfo) {
                    try
                    {
						if(displayInfo != null)
						{
							var displayWidth = displayInfo[0].workArea.width;

							if(displayWidth != null && displayWidth > 0)
								DEFAULT_SETTINGS.limitOfOpenedTabs = parseInt(displayWidth/90.29);

							//userDisplayHeight = displayInfo[0].workArea.height;
						}
                    }
                    catch (e)
                    {
                        console.error(e);
                    }

                    prepare();
				});
            }
            catch (e)
            {
                console.error(e);
                prepare();
            }
		else
			prepare();
	}

	/**
	 *
	 */
	function preInit(options) {
		"use strict";

		init(options);

		if (settings.get('active')) //{
			ticker = setInterval(tick, tickSize * 1000);

			//c5.browserAction.setIcon({'path': 'img/icon16.png'});
		//} else {
		//	c5.browserAction.setIcon({'path': 'img/icon16_off.png'});
		//}
        new BrowserActionControl(settings, whiteList, globalMenuIdMap, pauseTics).synchronizeActiveTabs();
	}

	window.addEventListener('load', start);
})();
