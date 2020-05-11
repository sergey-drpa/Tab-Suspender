/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
 
/*
 * TEMPORARY SOLUTION: TODO: Refactor with Global varialbe hash!!!
 */
 var lastIcon = "";
 
/**
 *
 */ 
function BrowserActionControl (settings, whiteList, globalMenuIdMap, pauseTics)
{
	"use strict";
	
	this.extensionTitle = "Tab Suspender";
	this.settings = settings;
	this.whiteList = whiteList;
	this.globalMenuIdMap = globalMenuIdMap;
	this.pauseTics = pauseTics;
}

/**
 *
 */
BrowserActionControl.prototype.updateStatus = function(tab)
{
	"use strict";
	
	var computedIcon;
	var isIconSet = false;
	
	/*if(window.isTabParked(tab))
		chrome.contextMenus.update(this.globalMenuIdMap["unsuspend_current_tab"],{enabled: true});
	else
		chrome.contextMenus.update(this.globalMenuIdMap["unsuspend_current_tab"],{enabled: false});*/
	
	if (this.settings.get('active')) {
		computedIcon = 'img/icon16.png';
	} else {
		computedIcon = 'img/icon16_off.png';
		isIconSet = true;
	}
	
	if(!isIconSet)
	{
		if(this.pauseTics > 0)
		{
			computedIcon = 'img/icon16_paused.png';
			isIconSet = true;
		}
		if(this.pauseTics <= 0)
			computedIcon = 'img/icon16.png';
	}
	
	var ignoredTab = false;
	var whitelistedTab = false;
	if(this.whiteList != null && this.globalMenuIdMap != null)
    {
    	if(ignoredTab=window.isTabInIgnoreTabList(tab.id))
		{
            chrome.contextMenus.update(this.globalMenuIdMap["ignore-current-tab"], {checked: true});
            //chrome.contextMenus.update(this.globalMenuIdMap["remove-current-tab-from-ignore"], {enabled: true});
		}
		else
        {
            chrome.contextMenus.update(this.globalMenuIdMap["ignore-current-tab"], {checked: false});
            //chrome.contextMenus.update(this.globalMenuIdMap["remove-current-tab-from-ignore"], {enabled: false});
        }

        if (whitelistedTab=this.whiteList.isURIException(tab.url))
        {
            this.setBrowserActionTitle(tab.id, this.extensionTitle + ": Page is in Whitelist");

            chrome.contextMenus.update(this.globalMenuIdMap["add_to_white_list"], {checked: true, title: 'Already in Whitelist'});
            //chrome.contextMenus.update(this.globalMenuIdMap["remove_from_white_list"], {enabled: true});
        }
        else
        {
            this.setBrowserActionTitle(tab.id, this.extensionTitle);

            chrome.contextMenus.update(this.globalMenuIdMap["add_to_white_list"], {checked: false, title: 'Add to Whitelist...'});
            //chrome.contextMenus.update(this.globalMenuIdMap["remove_from_white_list"], {enabled: false});
        }

        if(!isIconSet)
        {
            if(ignoredTab)
                computedIcon = 'img/icon16_green_minus.png';
            else if(whitelistedTab)
            {
                //if(tab.url.start)
                computedIcon = 'img/icon16_green.png';
            }
            else
                computedIcon = 'img/icon16.png';
        }
    }
	if(computedIcon != lastIcon)
	{
		chrome.browserAction.setIcon({'path': computedIcon});
		lastIcon = computedIcon;
	}
}

/**
 *
 */
BrowserActionControl.prototype.synchronizeActiveTabs = function()
{
	"use strict";
	
	var self = this;
	chrome.tabs.query({active: true}, function(tabs) {
		for (var i in tabs)
			if (tabs.hasOwnProperty(i))
				self.updateStatus(tabs[i]);
	});
}

/**
 *
 */
BrowserActionControl.prototype.setBrowserActionTitle = function(tabId, title)
{
	"use strict";

	var expectedExceptions = 'RegExp:No tab with id: \\d{1,5}\\.';
	chrome.browserAction.getTitle({tabId: tabId}, function(actualTitle){
        		if(!hasLastError(expectedExceptions))
					if(actualTitle != title)
						chrome.browserAction.setTitle({tabId: tabId, title: title}, function(){
							hasLastError(expectedExceptions);
						});
			});
}