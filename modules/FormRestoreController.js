/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 *
 */
function FormRestoreController ()
{
    "use strict";

    this.TIMEOUT = 7000;
    this.PREFIX = 'f_t';
    this.tabMap = {}; /* Key - actualTabId, Value - {timestamp: expectedTime, storedAsTabId: storedTabId, url: url} */

    setInterval(this.cleanup, 60000);
}

/**
 *
 */
FormRestoreController.prototype.getFormRestoreDataAndRemove = function(actualTabId)
{
    "use strict";

    var targetMapEntry = this.getTargetMapEntry(actualTabId);
    if(targetMapEntry == null)
        return  null;

    var key = this.PREFIX+targetMapEntry.storedAsTabId;
    var data = localStorage.getItem(key);
    localStorage.removeItem(key);

    return {'formData': data, 'url': targetMapEntry.url };
};

/**
 *
 */
FormRestoreController.prototype.getTargetMapEntry = function(actualTabId)
{
    "use strict";

    var tabMapEntry = this.tabMap[actualTabId];
    if(tabMapEntry != null)
    {
        if (this.isTabMapEntryOutdated(tabMapEntry))
            return null;
        else
            return tabMapEntry;
    }
};

/**
 *
 */
FormRestoreController.prototype.hebernateFormData = function(tabId)
{
    "use strict";

    var self = this;
    chrome.tabs.sendMessage(tabId, {method: "[AutomaticTabCleaner:HebernateFormData]"}, function (formData){
        if(debug)
            console.log("FData: ", formData);

        if (!formData)
            return;
        if(Object.keys(formData).length === 0 && formData.constructor === Object)
            return;

        localStorage.setItem(self.PREFIX+tabId, JSON.stringify(formData));
    });
};

/**
 *
 */
FormRestoreController.prototype.expectRestore = function(actualTabId, storedAsTabId, url)
{
    "use strict";

    if(actualTabId != null && storedAsTabId != null)
        this.tabMap[actualTabId] = {'timestamp': new Date().getTime(), 'storedAsTabId': storedAsTabId, 'url': url};
};

/**
 *
 */
FormRestoreController.prototype.cleanup = function()
{
    "use strict";

    for (var key in this.tabMap)
        if (this.tabMap.hasOwnProperty(key))
            if(this.isTabMapEntryOutdated(this.tabMap[key]))
                delete this.tabMap[key];
};

/**
 *
 */
FormRestoreController.prototype.isTabMapEntryOutdated = function(tabMapEntry)
{
    "use strict";

    return Date.now() - tabMapEntry.timestamp > this.TIMEOUT;
};