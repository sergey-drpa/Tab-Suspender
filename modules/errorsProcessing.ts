function trackErrors(pageName /* For example 'popup' */, buttons /* true/false */) {
	consoleLog(`trackErrors: ${pageName} - ${buttons}`)
}

function trackError(error) {
	consoleError(`trackError: ${error}`)
}

function trackView(viewName) {
	consoleLog(`trackView: ${viewName}`)
}

/* TODO-v3:
'use strict';

var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-131779988-1']);
_gaq.push(['_trackPageview']);

let sendErrorsStorageKey = 'store.tabSuspenderSettings.sendErrors';

let isSendErrorsEnabled = () => window.localStorage.getItem(sendErrorsStorageKey) === 'true' || window.localStorage.getItem(sendErrorsStorageKey) == null;

// eslint-disable-next-line no-redeclare,no-unused-vars
function trackErrors(pageName /!* For example 'popup' *!/, buttons /!* true/false *!/) {
	/!*************************
	 *   GA							     *
	 *************************!/
		if(typeof window !== "undefined") {

			var trackError = window.trackError = function(error) {
				if (isSendErrorsEnabled()) {
					_gaq.push(['_trackEvent', 'Error', pageName, JSON.stringify(error)]);
				}
			};
			window.trackView = function(viewName) {
				if (isSendErrorsEnabled()) {
					_gaq.push(['_trackPageview', viewName]);
				}
			};

			if (isSendErrorsEnabled()) {
				try {
					(function() {
						let ga = document.createElement('script');
						ga.type = 'text/javascript';
						ga.async = true;
						ga.src = 'lib/ga.js';
						let s = document.getElementsByTagName('script')[0];
						s.parentNode.insertBefore(ga, s);

						_gaq.push(['_setAccount', 'UA-131779988-1']);
						_gaq.push(['_trackPageview']);

						window.addEventListener('error', function(a) {
							console.log('Error catched: ', JSON.stringify(a.error));
							trackError(a.error);
						});
					})();

					let lastClick = { time: 0 };

					let trackButtonClick = function(e) {
						let id = null;
						if (e.target.id != null && e.target.id !== '')
							id = e.target.id;
						else if (e.target.className != null && e.target.className !== '')
							id = e.target.className;

						if (id != null) {
							if (lastClick.id !== id && Date.now() - lastClick.time > 1000) {
								lastClick = { time: Date.now(), 'id': id };
								_gaq.push(['_trackEvent', pageName, 'clicked', id]);
								lastClick.id = id;
								lastClick.time = Date.now();
							}
						}

						console.log(e.target);
					};

					if (buttons) {
						let buttons = document.querySelectorAll('div, a, input');
						for (let i = 0; i < buttons.length; i++) {
							buttons[i].addEventListener('click', trackButtonClick);
						}
					}
				} catch (e) {
					console.error(e);
				}
			}
		} else {
			console.log("Can't track error: window is not defined!")
		}
}

if (!('toJSON' in Error.prototype))
	Object.defineProperty(Error.prototype, 'toJSON', {
		value: function() {
			let alt = {};

			Object.getOwnPropertyNames(this).forEach(function(key) {
				alt[key] = this[key];
			}, this);

			return alt;
		},
		configurable: true,
		writable: true
	});
*/
