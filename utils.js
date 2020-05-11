"use strict";
var debug = false;

/**
 *
 */
window.nativeConsole = window.console;
window.console = {
    warn: window.nativeConsole.warn,
    assert: window.nativeConsole.assert,
    clear: window.nativeConsole.clear,
    count: window.nativeConsole.count,
    debug: window.nativeConsole.debug,
    dir: window.nativeConsole.dir,
    dirxml: window.nativeConsole.dirxml,
    error: window.nativeConsole.error,
    exception: window.nativeConsole.exception,
    group: window.nativeConsole.group,
    groupCollapsed: window.nativeConsole.groupCollapsed,
    groupEnd: window.nativeConsole.groupEnd,
    info: window.nativeConsole.info,
    msIsIndependentlyComposed: window.nativeConsole.msIsIndependentlyComposed,
    profile: window.nativeConsole.profile,
    profileEnd: window.nativeConsole.profileEnd,
    select: window.nativeConsole.select,
    table: window.nativeConsole.table,
    time: window.nativeConsole.time,
    timeEnd: window.nativeConsole.timeEnd,
    trace: window.nativeConsole.trace
};
console.log = function (message, message2, message3)
{
	var trace;
	if(debug)
        try { var a = {}; a.debug(); } catch(ex) {trace = ex.stack;}

    window.nativeConsole.log(message, message2, message3,(debug ? {trace: trace} : ''));
}

/**
 *
 */
console.error = function (message, exception, description)
{
	if(debug)
		chrome.notifications.create(
			{
				type: 'list',
				requireInteraction: true,
				iconUrl: 'img/icon16.png',
				title: "New Exception",
				message: ""+message,
				items: [
					{title: '', message: ""+message},
					{title: '', message: (exception && exception instanceof Error && exception.stack != null? exception.stack : ""+exception+"\n"+new Error().stack)}
				]
			}
		);

    //window.nativeConsole.error(arguments);
    window.nativeConsole.error.apply(this, arguments);

    if(trackError)
        try {
            var error;
            for(var i = 0; i < arguments.length; i++){
                if(arguments[i] != null && arguments[i] instanceof Error){
                    if(error == null)
                        error = arguments[i];
                    else
                        error.message += ' ->NestedException-> ' + arguments[i].message;
                }
            }

            if(error == null)
                error = new Error('');

            for (var i = 0; i < arguments.length; i++)
            {
                if (arguments[i] != null && typeof arguments[i] === 'string')
                    error.message += ' | ' + arguments[i];
                else if(arguments[i] != null && typeof arguments[i] === 'object' && !(arguments[i] instanceof Error))
                    error.message += ' | ' + JSON.stringify(arguments[i]);
            }

            if(error.message === '')
                error.message = 'Really no arguments provided!'

            trackError(error);
        } catch (e) {
            window.nativeConsole.error("Error while logging Error)) ", e);
        }
}

var globalIgnoredErrors = ['The browser is shutting down.',
                            'RegExp:No tab with id: \\d{1,5}\\.',
							'RegExp:Cannot discard tab with id: \\d{1,5}\\.'];
function hasLastError (expectedMassage)
{
    if (chrome.runtime.lastError)
    {
        var expectedList = [];
        if(expectedMassage != null && Array.isArray(expectedMassage))
            expectedList = expectedList.concat(expectedMassage);
        else
            for (var i = 0; i < arguments.length; i++)
                expectedList.push(arguments[i]);

        expectedList = expectedList.concat(globalIgnoredErrors);

        var expectedMessage = false;
        for(var i = 0; i < expectedList.length; i++) {
            if(expectedList[i].indexOf('RegExp:') === 0) { // REGEXP
                if(RegExp(expectedList[i].substr(7)).test(chrome.runtime.lastError.message))
                    expectedMessage = true;
            }
            else if (chrome.runtime.lastError.message === expectedList[i])
                expectedMessage = true;
        }

        if (expectedMessage)
            console.warn(chrome.runtime.lastError);
        else
            console.error(chrome.runtime.lastError);
        return true;
    }
    return false;
}

/**
 *
 */
function versionCompare(v1, v2, options)
{
    "use strict";
    
    var lexicographical = options && options.lexicographical,
        zeroExtend = options && options.zeroExtend,
        v1parts = v1.split('.'),
        v2parts = v2.split('.');

    function isValidPart(x) {
        return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
    }

    if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
        return NaN;
    }

    if (zeroExtend) {
        while (v1parts.length < v2parts.length) v1parts.push("0");
        while (v2parts.length < v1parts.length) v2parts.push("0");
    }

    if (!lexicographical) {
        v1parts = v1parts.map(Number);
        v2parts = v2parts.map(Number);
    }

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length == i) {
            return 1;
        }

        if (v1parts[i] == v2parts[i]) {
            continue;
        }
        else if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        else {
            return -1;
        }
    }

    if (v1parts.length != v2parts.length) {
        return -1;
    }

    return 0;
}

/**
 *
 */
function parseUrlParam(url, val) {
    "use strict";

    var tmp = [];
    var parts = url.substr(1).split(/[&\?]/);

    for(var i =0; i<parts.length;i++){
        tmp = parts[i].split("=");
        if (tmp[0] === val)
            return decodeURIComponent(tmp[1]);
    }

    return null;
}

/**
 *
 */
function sql_error (arg, arg2, arg3)
{
    "use strict";

    console.error("SQL error: "+arg+arg2+arg3, arg2);
}

/**
 *
 */
function detectBrowser()
{
    "use strict";

    var browser;

    // In Opera
    if (navigator.userAgent.indexOf("OPR/")!=-1)
        browser = "Opera";

    // In Chrome
    else if (navigator.userAgent.indexOf("Chrome")!=-1)
        browser = "Chrome";

    // In Microsoft internet explorer
    else if (navigator.userAgent.indexOf("MSIE")!=-1)
        browser = "MSIE";

    // In Firefox
    else if (navigator.userAgent.indexOf("Firefox")!=-1)
        browser = "Firefox";

    // In Safari
    else if (navigator.userAgent.indexOf("Safari")!=-1)
        browser = "Safari";

    console.log('Browser: '+browser);

    return browser;
}

function extractHostname(url) {
    var hostname;
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("://") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    return hostname;
}

/* Track Unistall - Experimantal *

var pingTimer = setInterval(ping, 6000);

 function ping() {
 var port = chrome.runtime.connect();
 if (port) {
 port.disconnect();
 return;
 }
 clearInterval(pingTimer);
 onDisabled();
 }

 function onDisabled() {
 try
 {
 clearInterval(pingTimer);
 } catch (e)
 {}

 var _gaq = _gaq || [];
 window._gaq = _gaq;
 _gaq.push(['_setAccount', 'UA-131779988-1']);
 _gaq.push(['_trackPageview']);

 var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
 ga.src = 'https://ssl.google-analytics.com/ga.js';
 var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);

 _gaq.push(['_setAccount', 'UA-131779988-1']);
 _gaq.push(['_trackPageview', 'uninstall']);

 _gaq.push(['_trackEvent', 'Uninstall', 'inject', 'uninstall']);

 console.log("Uninstall sended.	");
 }*/
