/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

"use strict";

var debug = false;
var cachedResult, currentTab, pauseTics, pauseTicsStartedFrom, ignodeCurrentTabChecked=false, tabInWhiteList=false;
var BG;

/*document.addEventListener('DOMContentLoaded', function () {  
	chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
		"use strict";
		try
		{
			currentTab = tabs[0];
			var manifest = chrome.runtime.getManifest();
			console.log(tabs[0]);
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:popupQuery]', tab: tabs[0]}, function(res) {	
				cachedResult = res;
			});
		}
		catch(e)
		{
			console.error(error);
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:trackError]', message: "Error in Popup"+error.message, stack: error.stack});
		}
	});
});*/

/***************************************
**************** ONLOAD ****************
****************************************/

document.addEventListener('DOMContentLoaded', function () {

    trackErrors('popup', true);

    document.getElementsByTagName('body')[0].className = chrome.i18n.getMessage("@@ui_locale");
    BG = chrome.extension.getBackgroundPage();

	chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
		try
		{
			currentTab = tabs[0];
			var manifest = chrome.runtime.getManifest();
			
			var res = BG.popupQuery(currentTab);
				
			if(res.isTabInIgnoreTabList)
			{
				ignodeCurrentTabChecked = true;
				document.querySelector('#ignodeCurrentTab').className = "menu checked";
			}
			
			if(res.isTabInWhiteList)
			{
				tabInWhiteList = true;
				//document.getElementById("pageInWhiteListInfoBuble").style.display="block";
				$('#addToWhilelist').addClass("checked");
				//$('#addToWhilelist').addClass("disabled");
			}
		
			if(!res.allowed)
			{
				$('#suspend').addClass("disabled");
				//$('#addToWhilelist').addClass("disabled");
			}

            if(res.isCloseTabsOn)
            {
                $('#recicleTab').prop('checked', true);
                $('.tab-button').addClass("checked");
            }
            else
            {
                $('#recicleTab').prop('checked', false);
                $('.tab-button').removeClass("checked");
            }
			
			if(tabs[0].url.indexOf(chrome.extension.getURL('park.html')) == 0)
				suspBtnSetSusp('#suspend');


			
			// Pause 
			pauseTics = res.pauseTics;
			pauseTicsStartedFrom = res.pauseTicsStartedFrom;

			if(pauseTics > 0)
                if(pauseInterval == null)
                    pauseInterval = setInterval(function(){ pauseTics--; recalculatePauseStatus (); }, 1000);
						
			recalculatePauseStatus ();
			
			var sliderDisabled;
			if(tabs[0].url != null && tabs[0].url == chrome.extension.getURL(manifest.options_page)){			
				sliderDisabled = true;
				document.querySelector("#settings").className="menu disabled";
			}
			else
				sliderDisabled = false;
			
			if(res.timeout != null){
				if(res.timeout > 3600)
					slider.update({from: res.timeout, min: 0, max: 21600, from_min: 60, step: 60, disable: sliderDisabled});
				else
					slider.update({from: res.timeout, min: 0, max: 3600, from_min: 60, step: 60, disable: sliderDisabled});
			}
								
			//console.log("res.closeTimeout"+res.closeTimeout);
			
			if(res.closeTimeout != null)
			{
				if(res.closeTimeout > 10800)
					sliderRecycleAfter.update({from: res.closeTimeout, max: 86400, disable: !res.isCloseTabsOn});
				else
					sliderRecycleAfter.update({from: res.closeTimeout, max: 10800, disable: !res.isCloseTabsOn});
			}
			
			if(res.limitOfOpenedTabs != null)
				sliderRecycleKeep.update({from: res.limitOfOpenedTabs, disable: !res.isCloseTabsOn});

            document.getElementById('versionSpan').innerText = "v"+res.TSVersion;

			if(debug)
				document.getElementById('tabId').textContent = res.tabId;
		}
		catch(e)
		{
			console.error(e);
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:trackError]', message: "Error in Popup"+error.message, stack: error.stack});
		}
	});

	$('.js-range-slider').ionRangeSlider({
		grid: true,
		min: 0,
		max: 3600,
		from_min: 60,    
		step: 60,
		hide_min_max: true,
		/*from: 60,    
		from_max: 86400,*/
		//hide_from_to: true,
		keyboard: true,
		keyboard_step: 1.1,
		prettify_enabled: true,
		prettify: function (seconds) {
		var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
		var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
		var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
		//console.log(this);

		var result;
		if(this.max > 3600)
            result = numhours + " h " + (numminutes > 0 ? (numminutes < 10 ? numminutes + "0" : numminutes) + " min" : "");
		else
            result = (numhours>0 ? numhours + " hour" : '') + ( numhours < 1 || numhours > 1 && numminutes > 0 ? numminutes + " min" : '');

		setTimeout(function()
        {
            updateJsRangeSliderTitle(result);
        }, 100);
		return result;
	},
		onFinish: function (data) {
			console.log("onFinish",data);
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', timeout: data.from}/*, function(res) {
				wakeUpSettingsPage({reloadOnly: true});
			}*/);
		}
	});

	function updateJsRangeSliderTitle(time)
    {
        $('.js-range-slider').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('autoSuspendSliderValue', [time]));
        $('.js-range-slider').parent().find('.irs-slider.single').attr('title', chrome.i18n.getMessage('autoSuspendSliderValue', [time]));
    }

	$('.js-range-slider-recicle-after').ionRangeSlider({
		grid: false,
		force_edges: true,
		min: 0,
		max: 86400,
		from_min: 60,    
		step: 60,
		hide_min_max: true,
		/*from: 60,    
		from_max: 86400,*/
		//hide_from_to: true,
		keyboard: true,
		keyboard_step: 0.5,
		prettify_enabled: true,
		prettify: function (seconds) {
			var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
			var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);

            var result = (numhours>0 ? numhours + " h " : '') + (numminutes>0 ? numminutes + " min " : '');
            setTimeout(function()
            {
                updateRecycleAfterSliderTitle(result);
            }, 100);

			return "Can close tabs after <b style='font-size: 11px;'>"+ result + "</b> of tab inactivity";
		},
		onFinish: function (data) {
			console.log("onFinish",data);
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', closeTimeout: data.from}/*, function(res) {
				wakeUpSettingsPage({reloadOnly: true});
			}*/);
		}
	});

    function updateRecycleAfterSliderTitle(time)
    {
        $('.js-range-slider-recicle-after').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('recycleAfterSliderValue', [time]));
    }
		
	$('.js-range-slider-recicle-keep').ionRangeSlider({
		grid: false,
		force_edges: true,
		min: 0,
		max: 100,
		from_min: 1,    
		step: 1,
		hide_min_max: true,
		/*from: 60,    
		from_max: 86400,*/
		//hide_from_to: true,
		keyboard: true,
		keyboard_step: 0.9,
		prettify_enabled: true,
		prettify: function (seconds) {

            setTimeout(function()
            {
                updateRecycleKeepSliderTitle(seconds);
            }, 100);
			
            return "...and when window have more than <b style='font-size: 11px;'>"+seconds+"</b> opened tabs";
		},
		onFinish: function (data) {
			//console.log("onFinish",data);
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', limitOfOpenedTabs: data.from}/*, function(res) {
				wakeUpSettingsPage({reloadOnly: true});
			}*/);
		}
	});

    function updateRecycleKeepSliderTitle(time)
    {
        $('.js-range-slider-recicle-keep').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('recycleKeepSliderValue', [time]));
    }


    var elementsWithLocalTitles = document.querySelectorAll("[title^=\"__MSG_\"]");
    for(var i in elementsWithLocalTitles)
    	if(elementsWithLocalTitles.hasOwnProperty(i))
		{
			var titleKey = elementsWithLocalTitles[i].title;
			if(titleKey != null)
				elementsWithLocalTitles[i].title = chrome.i18n.getMessage(titleKey.substr(6, titleKey.length-8));
		}


	var slider = $(".js-range-slider").data("ionRangeSlider");
	var sliderRecycleAfter = $(".js-range-slider-recicle-after").data("ionRangeSlider");
	var sliderRecycleKeep = $(".js-range-slider-recicle-keep").data("ionRangeSlider");
	
	
	
	
	/********************* BINDING EVENTS *******************/
	
	
	
	var wakeUpSettingsPage = document.querySelector('#settings').onclick = function (options) {

		var manifest = chrome.runtime.getManifest();
		var extviews = chrome.extension.getViews();
		
		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href == chrome.extension.getURL(manifest.options_page)) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id, {});
					if(options == null || options.reloadOnly == null || options.reloadOnly == false)
						chrome.tabs.update(tab.id, {"active": true});
                    	chrome.windows.update(tab.windowId, {focused: true});
				});
				break;
			}
			else if (i == extviews.length-1) {
				// Create new tab if past end of list and none open
				if(options == null || options.reloadOnly == null || options.reloadOnly == false)
					chrome.tabs.create({'url': manifest.options_page, 'active': true});
			}
		}		
		return false;
	};
	
	var historyPage = document.querySelector('#suspendHistory').onclick = function (options) {
		var extviews = chrome.extension.getViews();
		
		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href.indexOf(chrome.extension.getURL('history.html')) == 0) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id, {});
					if(options == null || options.reloadOnly == null || options.reloadOnly == false)
						chrome.tabs.update(tab.id, {"active": true});
				});
				break;
			}
			else if (i == extviews.length-1) {
				// Create new tab if past end of list and none open
				if(options == null || options.reloadOnly == null || options.reloadOnly == false)
					chrome.tabs.create({'url': 'history.html', 'active': true});
			}
		}		
		return false;
	};

	var sessionManager = document.querySelector('#sessionManager').onclick = function (options) {
		var extviews = chrome.extension.getViews();

		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i] && extviews[i].location.href.indexOf(chrome.extension.getURL('sessions.html')) == 0) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id, {});
					if(options == null || options.reloadOnly == null || options.reloadOnly == false)
						chrome.tabs.update(tab.id, {"active": true});
				});
				break;
			}
			else if (i == extviews.length-1) {
				// Create new tab if past end of list and none open
				if(options == null || options.reloadOnly == null || options.reloadOnly == false)
					chrome.tabs.create({'url': 'sessions.html', 'active': true});
			}
		}
		return false;
	};

	document.querySelector('#hotkeys').onclick = function (options) {
		chrome.tabs.create({'url': 'chrome://extensions/configureCommands'}, function(tab) {});
	};

	
	document.querySelector('#suspend').onclick = function () {
		if(document.querySelector('#suspend').className.indexOf('disabled') == -1)
			chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
					
				if(debug)
					console.log(tabs[0]);
				
				chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:suspendTab]', tab: tabs[0]}, function(res) {
					suspBtnSetSusp('#suspend');
					setTimeout(function(){window.close();}, 300);
				});
			});
	};

	document.querySelector('#suspendWindow').onclick = function () {
		
		if(document.querySelector('#suspendWindow').className.indexOf('disabled') == -1)
			chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
				chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:suspendWindow]', tab: tabs[0]}, function(res) {
					//suspBtnSetSusp('#suspendWindow');
					setTimeout(function(){window.close();}, 300);
				});
			});
	};

	document.querySelector('#suspendAllOther').onclick = function () {
		if(document.querySelector('#suspendAllOther').className.indexOf('disabled') == -1)
			chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
				chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:suspendAllOtherTabs]', tab: tabs[0]}, function(res) {
					//suspBtnSetSusp();
					setTimeout(function(){window.close();}, 300);
				});
			});
	};

	document.querySelector('#unsuspendAll').onclick = function () {
		if(document.querySelector('#unsuspendAll').className.indexOf('disabled') == -1)
			chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
				chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:unsuspendAllTabs]', tab: tabs[0]}, function(res) {
					//suspBtnSetSusp();
					setTimeout(function(){window.close();}, 300);
				});
			});
	};

	document.querySelector('#unsuspendWindow').onclick = function () {
		
		if(document.querySelector('#unsuspendWindow').className.indexOf('disabled') == -1)
			chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
				chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:unsuspendWindow]', tab: tabs[0]}, function(res) {
					//suspBtnSetSusp('#unsuspendWindow');
					setTimeout(function(){window.close();}, 300);
				});
			});
	};
	
	document.getElementById('addToWhilelist').onclick = function () {
		if(tabInWhiteList)
			return;
		
		chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
			if(tabs[0].url.includes("//chrome.google.com") )
			{
				// TODO: todo
				//alert('chrome.google.com');
				chrome.tabs.create({
					windowId: tabs[0].windowId,
					index: tabs[0].index+1,
					url: chrome.extension.getURL('dialog.html')+"?separate_tab=true&requester_tab_id="+tabs[0].id+"&url="+encodeURIComponent(tabs[0].url)});

			}
			else
				chrome.tabs.sendMessage(tabs[0].id, {'method': "[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]", 'tab': tabs[0]}, function(res) { //chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:unsuspendTab]', tab: tabs[0]}, function(res) {
					//setTimeout(function(){
					//	chrome.tabs.sendMessage(tabs[0].id, {method: "[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]"});
					//	window.close();
					//}, 500);
				});
		});
		
		setTimeout(function(){window.close();}, 300);
	};

	/**
	 * TODO: WIZARD
	 */
    /*debugger;
    document.getElementById('versionSpan').onclick = function () {
        "use strict";

        debugger;
        chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {'method': "[AutomaticTabCleaner:DrawSetupWizardDialog]", 'tab': tabs[0]}, function(res) { //chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:unsuspendTab]', tab: tabs[0]}, function(res) {
            });
        });

        setTimeout(function(){window.close();}, 300);
    };*/

	
	document.getElementById('donate').onclick = function () {
		
		chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:donate]'});
		setTimeout(function(){window.close();}, 300);
		
		return false;
	};

	document.querySelector('#pause-first-btn').onclick = function () {
		pause(600);
	}
	document.querySelector('#pause-second-btn').onclick = function () {
		pause(3599);
	}
    document.querySelector('#pause-third-btn').onclick = function () {
        pause(3600*5);
    }
	document.querySelector('#pause-forth-btn').onclick = function () {
        pause(3600*24);
    }
	document.querySelector('#resetPauseTimer').onclick = function () {
		pause(0);
	}
	
	
	document.getElementById('removePageFromWhitelist').onclick = function (options) {
		
		chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:removeUrlFromWhitelist]', url: currentTab.url }, function(res) {
		});
		
		window.close();
		return false;
	};	


	document.querySelector('#progress-bar').onclick = function () {

		chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:pause]', pauseTics: 0}, function(res) {
			document.querySelector('#pause').className = "menu menu-inline";
			
			pauseTics = res.pauseTics;
			pauseTicsStartedFrom = res.pauseTics;
			recalculatePauseStatus ();
		});		
	}

	document.querySelector('#ignodeCurrentTab').onclick = function () {

		if(ignodeCurrentTabChecked)
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:ignoreTab]', tabId: currentTab.id, action: "remove"}, function(res) {
				ignodeCurrentTabChecked = false;
				document.querySelector('#ignodeCurrentTab').className = "menu";
			});
		else
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:ignoreTab]', tabId: currentTab.id, action: "add"}, function(res) {
				ignodeCurrentTabChecked = true;
				document.querySelector('#ignodeCurrentTab').className = "menu checked";
			});
	}
	

	/** RECICLE POPUP LOGIC */
	var recicleTabCheckbox;
	(recicleTabCheckbox = document.querySelector('#recicleTab')).onchange = function (event) {
		if(recicleTabCheckbox.checked)	
		{
			$('.tab-button').addClass("checked");
			sliderRecycleAfter.update({disable: false});
			sliderRecycleKeep.update({disable: false});
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', isCloseTabsOn: true}/*, function(res) {
				wakeUpSettingsPage({reloadOnly: true});
			}*/);
		}
		else
		{
			$('.tab-button').removeClass("checked");
			sliderRecycleAfter.update({disable: true});
			sliderRecycleKeep.update({disable: true});
			
			chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', isCloseTabsOn: false}/*, function(res) {
				wakeUpSettingsPage({reloadOnly: true});
			}*/);
		}
	};

	var focus = false;
	var focusInHandler = document.querySelector('.tab-button').onclick = /*document.querySelector('.recicle-section').onmouseover =*/ function (event) {
		$('.recicle-section').addClass("visible");
		$('.tab-button').addClass("visible");
	};

	var tabButtonLinkClick;
	$('.tab-button-link').click(tabButtonLinkClick=function (event) {
		if($('.tab-button').hasClass('visible') &&  event != null)
		{
			focus = false;
			$('.recicle-section').removeClass("visible");
			$('.tab-button').removeClass("visible");
		}
		else
		{
			$('.recicle-section').addClass("visible");
			$('.tab-button').addClass("visible");
		}
		
			if(event != null)
					event.stopPropagation();
	});

	$('.tab-button, .recicle-section').focusin(function() {
		focus = true;
		console.log("Focus!");
	});

	var focusOutHandler = document.querySelector('.tab-button').onmouseout = document.querySelector('.recicle-section').onmouseout = function (event) {
		if(!event)
			return;
		
		if(focus)
			return;
		
		if(event && event.relatedTarget && ($(event.relatedTarget).hasClass('tab-button') || $(event.relatedTarget).parents('.tab-button').length > 0 || $(event.relatedTarget).hasClass('recicle-section') || $(event.relatedTarget).parents('.recicle-section').length > 0) )
			return;
			//debugger;

		$('.recicle-section').removeClass("visible");
		$('.tab-button').removeClass("visible");
	};

	$('.tab-button, .recicle-section').focusout(function(event){
		console.log("FocusOut!");
		setTimeout(function(){
			focus = false;
			focusOutHandler();
		}, 100);
	});

	var timeoutId;
	$(".tab-button").hover(function(event){
		if(!$('.tab-button').hasClass('visible'))
			if (!timeoutId) {
				timeoutId = window.setTimeout(function() {
					timeoutId = null; // EDIT: added this line
					tabButtonLinkClick(null);
			   }, 300);
			}
	},
	function () {
		if (timeoutId) {
			window.clearTimeout(timeoutId);
			timeoutId = null;
		}
		else {
			//if(!focus)
			//{
					//$('.recicle-section').removeClass("visible");
					//$('.tab-button').removeClass("visible");
			//}
		}
	});
});


/************************************
**************** UTILS **************
*************************************/

	
var secondsFormater = function (seconds)
{
	var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
	var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
	var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
	return "   " + (numhours>0 ? numhours + " hours " : '') + (numminutes>0 ? ' ' + numminutes + " min" : '') + (numseconds > 0 && numhours <= 0 ? ' ' + numseconds + " sec" : '');
}

function suspBtnSetSusp (selector){
	document.querySelector(selector).className = "inline-btn disabled parked";
	document.querySelector(selector).text = "Suspended";
}
	
function recalculatePauseStatus ()
{
	if(pauseTics >0 && pauseTicsStartedFrom >0)
	{
		//ebugger;
		var width = parseInt(document.body.style.width);
		var pxPerProc = (width/100);
		var procent = (pauseTics/(pauseTicsStartedFrom/100));		
		document.querySelector('.progress-bar').style.width=procent*pxPerProc+"px";
		document.querySelector('.progress-bar').style.left=0;//width-procent*pxPerProc+"px";
		
		document.querySelector('.progress-bar span').innerHTML = secondsFormater(pauseTics);
	}
	else
	{
		document.querySelector('.progress-bar').style.width="0px";
		document.querySelector('.progress-bar span').innerHTML = "";
	}
		
	var sliders = document.querySelectorAll('#slider');
	if(pauseTics > 0)
	{
		document.querySelector('#pause').className = "menu stage2";
		document.querySelector('#pause .menu').innerHTML = "Suspender Paused for:";
		for(var i in sliders)
			if(sliders.hasOwnProperty(i))
				sliders[i].className = "disabled";
	}
	else
	{
		document.querySelector('#pause').className = "menu ";
		document.querySelector('#pause .menu').innerHTML = "Pause Suspender:";
		for(var i in sliders)
			if(sliders.hasOwnProperty(i))
				sliders[i].className = "";
		clearInterval(pauseInterval);
		pauseInterval = null;
	}
}
	

var pauseInterval = null;
function pause (period) {
	
	//if(document.querySelector('#pause').className.indexOf('disabled') == -1)		
		chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:pause]', pauseTics: period}, function(res) {
			document.querySelector('#pause').className = "menu menu-inline disabled";
			
			pauseTics = res.pauseTics;
			pauseTicsStartedFrom = res.pauseTics;
			recalculatePauseStatus ();
		});

	if(pauseInterval == null)
    	pauseInterval = setInterval(function(){ pauseTics--; recalculatePauseStatus (); }, 1000);
};

/*** NOT IMPLEMENTED ***/
/*document.querySelector('#whitelistButton').onclick = function () {
	
	chrome.tabs.getSelected(null, function(tab) {
		document.querySelector('#inputLabel').className="visible";
		document.querySelector('#whitelistInput').value = tab.url;
		document.querySelector('#whitelistInput').className="visible";
		document.querySelector('#whitelistAddButton').className="visible";
		document.querySelector('#whitelistButton').className="invisible";
		document.querySelector('#settings').className="invisible";		
	});
};*/

/*** NOT IMPLEMENTED ***/
/*document.querySelector('#whitelistAddButton').onclick = function () {
	
	chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:addExceptionPatterns]', pattern: document.querySelector('#whitelistInput').value}, function(res) {				
		var manifest = chrome.runtime.getManifest();		
		var extviews = chrome.extension.getViews();

		for (var i=0; i<=extviews.length; i++) {
			if (extviews[i].location.href == chrome.extension.getURL(manifest.options_page)) {
				extviews[i].chrome.tabs.getCurrent(function (tab) {
					chrome.tabs.reload(tab.id);
					//alert("reload");
				});
			}
		}
		//if(res.successful == true)
			window.close();		
	});
}*/



