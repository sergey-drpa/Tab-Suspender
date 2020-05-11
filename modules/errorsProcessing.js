"use strict";

var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-131779988-1']);
_gaq.push(['_trackPageview']);

function trackErrors (pageName /* For example 'popup' */, buttons /* true/false */) {
    /*************************
     *   Google Analytics    *
     *************************/
    try
    {
        (function ()
        {
            var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
            ga.src = 'modules/ga.js'; //'https://ssl.google-analytics.com/ga.js';
            var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);

            _gaq.push(['_setAccount', 'UA-131779988-1']);
            _gaq.push(['_trackPageview']);

            window.addEventListener("error", function (a, b, c, d)
            {
                console.log('Error catched: ', JSON.stringify(a.error));
                trackError(a.error);
            });
        })();

        var lastClick = {time: 0};

        var trackButtonClick = function (e)
        {
            var id = null;
            if (e.target.id != null && e.target.id !== '')
                id = e.target.id;
            else if (e.target.className != null && e.target.className !== '')
                id = e.target.className;

            if (id != null)
            {
                if (lastClick.id !== id && Date.now() - lastClick.time > 1000)
                {
                    lastClick = {time: Date.now(), 'id': id};
                    _gaq.push(['_trackEvent', pageName, 'clicked', id]);
                    lastClick.id = id;
                    lastClick.time = Date.now();
                }
            }

            console.log(e.target);
        };

        if(buttons) {
            var buttons = document.querySelectorAll('div, a, input');
            for (var i = 0; i < buttons.length; i++)
            {
                buttons[i].addEventListener('click', trackButtonClick);
            }
        }
    } catch (e) {
        console.error(e);
    }

    window.trackError = function (error){
        _gaq.push(['_trackEvent', 'Error', pageName, JSON.stringify(error)]);
    }
    window.trackView = function (viewName){
        _gaq.push(['_trackPageview', viewName]);
    }
}

if (!('toJSON' in Error.prototype))
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            var alt = {};

            Object.getOwnPropertyNames(this).forEach(function (key) {
                alt[key] = this[key];
            }, this);

            return alt;
        },
        configurable: true,
        writable: true
    });