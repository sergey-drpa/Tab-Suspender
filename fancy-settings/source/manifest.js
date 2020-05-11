var pinTabExampleHref = chrome.extension.getURL('/img/pin-tab-example.png');
var audibleTabExampleHref = chrome.extension.getURL('/img/audible-tab-example.png');

this.manifest = {
    'name': 'Tab Suspender All Settings',
    'icon': '../../img/icon32.png',
    'settings': [
		{
            'tab': 'Suspend Settings',
            'group': 'Enabled',
            'name': 'active',
            'type': 'checkbox',
            'label': 'On'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Enabled',
            'name': 'enabled-description',
            'type': 'description',
            'text': 'Enable or Disable all Tab Suspender activity'
        },
		
        {
            'tab': 'Suspend Settings',
            'group': 'Suspend interval',
            'name': 'timeout',
            'type': 'slider',
            'label': 'Auto-Suspend tab after: ',
            'max': 6 * 60 * 60,
            'min': 10,
            'step': 10,
            'step2': 1 * 60,
            'stepChangeIfGreatThen': 60,
            'display': true,
            'displayModifier': /*function (value) {
                "use strict";
                return Math.floor(value) + ' sec.';
            }*/
				function (seconds)
				{
					var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
					var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
					var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
					return "   " + (numhours>0 ? numhours + " hours " : '') + (numminutes>0 ? numminutes + " minutes " : '') + (numseconds > 0 && numminutes <= 10 ? numseconds + " seconds" : '') + " of inactivity";
				}
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Suspend interval',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Timeout before unused tab will be parked'
        },

        {
            'tab': 'Suspend Settings',
            'group': 'Suspend interval',
            'name': 'adaptiveSuspendTimeout',
            'type': 'checkbox',
            'label': 'Adaptive  <font color="#0099FF">(New)</font>'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Suspend interval',
            'name': 'adaptiveSuspendTimeout-description',
            'type': 'description',
            'text': 'Recalculate Auto-Suspend Timeout for each Tab based on user interaction with tabs.'
        },
        /* time spent on Tab and number of returns to Tab */
		
		{
            'tab': 'Suspend Settings',
            'group': 'Battery',
            'name': 'autoSuspendOnlyOnBatteryOnly',
            'type': 'checkbox',
            'label': 'Auto-Suspend tabs only when working on battery'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Battery',
            'name': 'battery-only-description',
            'type': 'description',
            'text': 'If option turned on Auto-Suspend will not work when laptop works on the power cord'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Battery',
            'name': 'enableSuspendOnlyIfBattLvlLessValue',
            'type': 'checkbox',
            'label': 'Auto-Suspend tabs only when... <!--Battery Level less then next value and power cord detached <font color="#0099FF">(New)</font-->'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Battery',
            'name': 'battLvlLessValue',
            'type': 'slider',
            'label': 'battery level less then: ',
            'max': 100,
            'min': 0,
            'step': 1,
            'step2': 1,
            'stepChangeIfGreatThen': 20,
            'display': true,
            'displayModifier': /*function (value) {
             "use strict";
             return Math.floor(value) + ' sec.';
             }*/
                function (seconds)
                {
                    return seconds + "%";
                }
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Battery',
            'name': 'battery-only-description-2',
            'type': 'description',
            'text': 'If this option turned on Auto-Suspend will not work when: <br/>&nbsp;&nbsp;&nbsp;&nbsp;1. Battery Level great then selected above and <br/>&nbsp;&nbsp;&nbsp;&nbsp;2. Laptop works on the power cord'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Ignore options',
            'name': 'pinned',
            'type': 'checkbox',
            'label': 'Ignore Pinned tab'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Ignore options',
            'name': 'pinned-description',
            'type': 'description',
            'text': 'Ignore <a href="'+pinTabExampleHref+'" target="_blank" class="settings-link">pinned</a> tabs from being suspended'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Ignore options',
            'name': 'ignoreAudible',
            'type': 'checkbox',
            'label': 'Ignore <a href="'+audibleTabExampleHref+'" target="_blank" class="settings-link">audible</a> tab'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Ignore options',
            'name': 'pinned-description',
            'type': 'description',
            'text': 'Ignore tabs plays music'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Advanced',
            'name': 'discardTabAfterSuspendWithTimeout',
            'type': 'checkbox',
            'label': 'Discard Tabs <font color="#0099FF">(New)</font>'
        },
        {
            'tab': 'Suspend Settings',
            'group': 'Advanced',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Enable automatic discard suspended tabs to free up even more memory'
        },







		
		{
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'isCloseTabsOn',
            'type': 'checkbox',
            'label': 'On'
        },
        {
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Enable or Disable automatic closing tabs function (working by settings below)'
        },
		{
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'closeTimeout',
            'type': 'slider',
            'label': 'Close tab after:',
            'max': 24 * 60 * 60,
            'min': 60,
            'step': 1 * 60,
            'display': true,
            'displayModifier': function (value) {
                "use strict";
                return Math.floor(value / 60) + (value > 1 ? ' minutes' : 'minute') + " of inactivity";
            }
        },
        {
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Timeout before unused tab could be closed (0 - Never)'
        },
		{
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'limitOfOpenedTabs',
            'type': 'slider',
            'label': 'Limit of total opened Tabs: ',
            'max': 200,
            'min': 1,
            'step': 1,
            'display': true,
            'displayModifier': function (value) {
                "use strict";
                return Math.floor(value) + ' tabs';
            }
        },
        {
            'tab': 'Auto-close Tabs',
            'group': 'Close tabs automatically',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'The max. amount of tabs that Tab Suspender will try to keep opened to reduce memory. (if opened tabs count exceeds the selected amount - Tab Suspender will start smoothly close most unused tabs, until the number of opened tabs decreases to the selected amount)'
        },







 
		{
            'tab': 'Visual',
            'group': 'Background color',
            'name': 'parkBgColor',
            'type': 'colorPicker',
            'label': 'Background color of suspended page:'
        },
        {
            'tab': 'Visual',
            'group': 'Background color',
            'name': 'parkBgColor-description',
            'type': 'description',
            'text': "Choose background color to make suspended pages more darker or more lighter (Default value is 'FFFFFF' - without any color)"
        },

        {
            'tab': 'Visual',
            'group': 'Design of Restore button',
            'name': 'restoreButtonView',
            'type': 'listBox',
            'options': [['roundIcon','Blue Round Icon at the center of the page - Default'],['noIcon', 'No Icon - Only page screenshot'],['topBar', 'Semi-transparent bar at the top of the page']],
            'label': 'Design of Restore button on suspended page: <font color="#0099FF">(New)</font>'
        },

        {
            'tab': 'Visual',
            'group': 'Screenshot quality',
            'name': 'screenshotQuality',
            'type': 'slider',
            'label': 'Quality of the page preview:',
            'max': 100,
            'min': 10,
            'step': 1,
            'display': true,
            'displayModifier': function (value) {
                "use strict";
                return Math.floor(value) + ' %';
            }
        },
        {
            'tab': 'Visual',
            'group': 'Screenshot quality',
            'name': 'screen-quality-description',
            'type': 'description',
            'text': '10% - Minimum Quality, 100% - Best Quality'
        },
        {
            'tab': 'Visual',
            'group': 'Icon animation',
            'name': 'animateTabIconSuspendTimeout',
            'type': 'checkbox',
            'label': 'Tab icon status animation'
        },
        {
            'tab': 'Visual',
            'group': 'Icon animation',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Enable tab icon animation in accordance with the time remaining before the tab will be suspended'
        },
        {
            'tab': 'Visual',
            'group': 'Advanced',
            'name': 'screenshotCssStyle',
            'type': 'text',
            'label': 'Additional CSS styles for suspended page Screenshot: <font color="#0099FF">(New)</font>',
            'text': 'filter: blur(1px);\nfilter: opacity: 1;\n'
        },






        {
            'tab': 'Whitelist',
            'group': 'White List',
            'name': 'exceptionPatternsV2',
            'type': 'whitelist',
            'label': 'Site patterns:'
        },
        {
            'tab': 'Whitelist',
            'group': 'White List example',
            'name': 'pinned-description',
            'type': 'description',
            'text': 'For example to disable suspend function on all Google sites you can add next text on new line: <b>*.google.com*</b>,<br/>if you want to exclude for example all sites starting with subdomain "subdomain" just add <b>subdomain.*</b> on a new line'
        },




		
		
       {
            'tab': 'New Tabs',
            'group': 'New Tabs',
            'name': 'openUnfocusedTabDiscarded',
            'type': 'checkbox',
            'label': 'Open new tabs discarded'
        },
        {
            'tab': 'New Tabs',
            'group': 'New Tabs',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Do not load not active tabs immediately, load it discarded.'
        },






		{
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'autoRestoreTab',
            'type': 'checkbox',
            'label': 'Restore Automatically'
        },
        {
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Restore suspended tab automatically when the tab becomes active/(gets focus)'
        },
		{
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'reloadTabOnRestore',
            'type': 'checkbox',
            'label': 'Reload site on restore'
        },		
        {
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Reload site on restore instead of default behavior: get site from browser cache'
        },
		{
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'restoreOnMouseHover',
            'type': 'checkbox',
            'label': 'Restore on mouse hover'
        },		
        {
            'tab': 'Restore Tab',
            'group': 'Restore Tab',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Restore on mouse hover instead of click on restore icon'
        },
		
		{
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'startDiscarted',
            'type': 'checkbox',
            'label': 'Start suspended tabs discarded on browser startup <font color="#0099FF">(New)</font>'
        },
        {
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'On browser startup suspended tabs will not get browser resources but will be visible as tab'
        },

        {
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'startNormalTabsDiscarted',
            'type': 'checkbox',
            'label': 'Open normal tabs discarded on browser startup <font color="#0099FF">(New)</font>'
        },
        {
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'On browser startup normal tabs will not get browser resources but will be visible as tab'
        },

        {
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'restoreTabOnStartup',
            'type': 'checkbox',
            'label': 'Unsuspend suspended tabs on startup'
        },
        {
            'tab': 'Startup',
            'group': 'Startup',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'Restore suspended tabs to normal web page on extention/browser startup'
        },







        {
            'tab': 'Reset Settings',
            'group': 'Reset All Settings',
            'name': 'resetAllSettings',
            'type': 'button',
            'text': 'Reset All Settings to default',
            'onclick': function(){
                if(window.confirm("Are you sure that you want to reset all Tab Suspender settings?"))
                    chrome.extension.sendRequest({ method: '[AutomaticTabCleaner:resetAllSettings]'});
            }
        },
        {
            'tab': 'Reset Settings',
            'group': 'Reset All Settings',
            'name': 'timeout-description',
            'type': 'description',
            'text': 'If you have some problems with current Tab Suspender configuration you can reset all settings to default.'
        },







    ],
    'alignment': [
        [
            'timeout'
        ]
    ]
};