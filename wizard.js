/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

document.addEventListener('DOMContentLoaded', function() {
	(function() {
		'use strict';

		window.focus();
		let overlay = document.querySelector('.overlay');
		let closeDialog;

		trackErrors('wizard', true);

		overlay.addEventListener('click', closeDialog = function() {
			chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:hideDialog]' });
		});

		let WIZARD_TITLE = 'Tab Suspender Wizard';

		document.querySelector('#defaultsButton').addEventListener('click', closeDialog);

		document.onkeydown = function(evt) {
			evt = evt || window.event;
			if (evt.keyCode == 27) {
				closeDialog();
			}
		};

		let tooltipSpan = document.getElementById('tooltip-span');

		window.onmousemove = function(e) {
			let x = e.clientX,
				y = e.clientY;
			tooltipSpan.style.top = (y + 5) + 'px';
			tooltipSpan.style.left = (x - 240) + 'px';
		};

		function getCurrentStepNumber() {
			return parseInt(document.querySelector('.dialog-content.active-step').getAttribute('step'));
		}

		let stepElements = document.querySelectorAll('.dialog-content');


		let stepListener = function(delta) {

			let currentElementStep = getCurrentStepNumber();
			removeClass(stepElements[currentElementStep - 1], 'active-step');
			$(stepElements[currentElementStep - 1]).fadeOut(500);
			addClass(stepElements[currentElementStep - 1 + delta], 'active-step');
			$(stepElements[currentElementStep - 1 + delta]).fadeIn(500);

			/* Recalculate current step */
			currentElementStep = parseInt(document.querySelector('.dialog-content.active-step').getAttribute('step'));
			console.log('Step: ', currentElementStep);

			document.getElementById('wizardTitle').innerText = WIZARD_TITLE + ' (Step ' + currentElementStep + ' of ' + stepElements.length + ')';

			if (currentElementStep == 3)
				$('input[type="radio"].closeRadio').change();

			refreshNextButton(currentElementStep);
			refreshPreviousButton(currentElementStep);
			refreshSkipButton(currentElementStep);
			refreshFinishButton(currentElementStep);
			refreshCloseButton(currentElementStep);

			updatePage4();
		};

		document.getElementById('nextButton').addEventListener('click', function() {
			stepListener(+1);
		});
		document.getElementById('finishButton').addEventListener('click', function() {
			stepListener(+1);
		});
		document.getElementById('previousButton').addEventListener('click', function() {
			stepListener(-1);
		});
		document.getElementById('defaultsButton').addEventListener('click', function() {
			stepListener(stepElements.length - getCurrentStepNumber());
		});
		document.getElementById('closeButton').addEventListener('click', function() {
			try {
				chrome.tabs.query({ currentWindow: true/*, active: true*/ }, function(tabs) {
					try {
						let indexes = [];
						let activeIndex;
						for (let i = 0; i < tabs.length; i++) {
							indexes[tabs[i].index] = tabs[i];
							if (tabs[i].active == true)
								activeIndex = tabs[i].index;
						}
						if (activeIndex != null)
							chrome.tabs.update(indexes[activeIndex - 1].id, { 'active': true });
						// eslint-disable-next-line no-empty
					} catch (e) {
					}

					window.close();
					top.window.close();
				});
			} catch (e) {
				window.close();
				top.window.close();
			}
		});

		function refreshNextButton(step) {
			if (step < stepElements.length - 1)
				addClass(document.getElementById('nextButton'), 'active');
			else
				removeClass(document.getElementById('nextButton'), 'active');
		}

		function refreshPreviousButton(step) {
			if (step > 1 && step <= stepElements.length)
				addClass(document.getElementById('previousButton'), 'active');
			else {
				removeClass(document.getElementById('previousButton'), 'active');
			}
		}

		function refreshSkipButton(step) {
			if (step == 1)
				addClass(document.getElementById('defaultsButton'), 'active');
			else
				removeClass(document.getElementById('defaultsButton'), 'active');
		}

		function refreshFinishButton(step) {
			if (step == stepElements.length - 1)
				addClass(document.getElementById('finishButton'), 'active');
			else
				removeClass(document.getElementById('finishButton'), 'active');
		}

		function refreshCloseButton(step) {
			if (step == stepElements.length)
				addClass(document.getElementById('closeButton'), 'active');
			else
				removeClass(document.getElementById('closeButton'), 'active');
		}

		function removeClass(element, className) {
			element.className = element.className.split(className).join('');
		}

		function addClass(element, className) {
			if (element.className.indexOf(className) == -1)
				element.className = element.className + ' ' + className;
		}


		let timeoutPrettifer;
		(function() {
			$('.js-range-slider-suspend-timeout').ionRangeSlider({
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
				prettify: timeoutPrettifer = function(seconds) {
					//console.log("P: "+seconds);
					let numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
					let numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
					if (this != null && this.max > 3600)
						return numhours + ':' + (numminutes < 10 ? numminutes + '0' : numminutes);
					else
						return (numhours > 0 ? numhours + ' hour' : '') + (numhours < 1 || numhours > 1 && numminutes > 0 ? numminutes + ' min ' : '');
				},
				onFinish: function(data) {
					console.log('onFinish', data);
					chrome.extension.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', timeout: data.from });
				}
			});
		})();

		let prettifyVarCountRecicleKeep = 0;
		(function() {
			$('.js-range-slider-recicle-keep').ionRangeSlider({
				grid: true,
				force_edges: true,
				min: 0,
				max: 100,
				from_min: 1,
				step: 1,
				hide_min_max: true,
				keyboard: true,
				keyboard_step: 0.9,
				prettify_enabled: true,
				prettify: function(seconds) {
					prettifyVarCountRecicleKeep++;

					if (prettifyVarCountRecicleKeep < 6)
						return seconds;
					else
						return chrome.i18n.getMessage('wizard_recycleKeepSliderValue', [seconds]);//"...and if there are more than <b style='font-size: 14px;'>"+seconds+"</b> opened tabs";
				},
				onFinish: function(data) {

					chrome.extension.sendMessage({
						method: '[AutomaticTabCleaner:updateTimeout]',
						limitOfOpenedTabs: data.from
					});
				}
			});

		})();

		let prettifyVarCountRecicleAfter = 0;
		(function() {
			$('.js-range-slider-recicle-after').ionRangeSlider({
				grid: true,
				force_edges: true,
				min: 0,
				max: 86400 / 6,
				from_min: 60,
				step: 60,
				hide_min_max: true,
				keyboard: true,
				keyboard_step: 0.5,
				prettify_enabled: true,
				prettify: function(seconds) {
					prettifyVarCountRecicleAfter++;
					//debugger;
					let numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
					let numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);

					let result = (numhours > 0 ? numhours + ' hour' + (numhours > 1 ? 's ' : ' ') : '') + (numminutes > 0 ? numminutes + ' min ' : (numhours <= 0 ? '0' : ''));

					if (prettifyVarCountRecicleAfter < 6)
						return result;
					else
						return chrome.i18n.getMessage('wizard_recycleAfterSliderValue', [result]);//"Suspender will close tabs after <b style='font-size: 14px;'>"+ result + "</b> of inactivity";
				},
				onFinish: function(data) {
					console.log('onFinish', data);

					chrome.extension.sendMessage({
						method: '[AutomaticTabCleaner:updateTimeout]',
						closeTimeout: data.from
					});
				}
			});
		})();

		/**
		 *
		 * PAGE 2
		 *
		 */
		$('input[type="radio"].closeRadio').on('change', function() {
			if ($(this).hasClass('no') && $(this).prop('checked')) {
				$('.close-sliders').addClass('hidden');
				chrome.extension.sendMessage({
					method: '[AutomaticTabCleaner:updateTimeout]',
					isCloseTabsOn: false
				});
			}
			if ($(this).hasClass('yes') && $(this).prop('checked')) {
				$('.close-sliders').removeClass('hidden');
				chrome.extension.sendMessage({
					method: '[AutomaticTabCleaner:updateTimeout]',
					isCloseTabsOn: true
				});
			}
		});

		/*
		 * PAGE 4
		 */

		document.getElementById('debugCheckbox').onchange = () => {
			chrome.extension.sendMessage({
				method: '[AutomaticTabCleaner:updateTimeout]',
				sendErrors: document.getElementById('debugCheckbox').checked === true
			});
		};

		function updatePage4() {
			let BG = chrome.extension.getBackgroundPage();
			let res = BG.popupQuery({ id: 0, url: '' });
			let timeout = parseInt(res.timeout);
			document.getElementById('resultTimeoutValue').innerText = timeoutPrettifer(timeout).trim();
		}

		/* READ DEFAULT CONFIGURATION */
		(function() {
			let BG = chrome.extension.getBackgroundPage();
			let res = BG.popupQuery({ id: 0, url: '' });
			$('.js-range-slider-suspend-timeout').data('ionRangeSlider').update({ from: res.timeout });
			prettifyVarCountRecicleKeep = 0;
			$('.js-range-slider-recicle-keep').data('ionRangeSlider').update({ from: res.limitOfOpenedTabs });
			prettifyVarCountRecicleAfter = 0;
			$('.js-range-slider-recicle-after').data('ionRangeSlider').update({ from: res.closeTimeout });

			if (res.isCloseTabsOn)
				$('input:radio[name=closeRadio][value=yes]').click();//.attr('checked', 'checked');
			else
				$('input:radio[name=closeRadio][value=no]').click();//.attr('checked', 'checked');

			document.getElementById('debugCheckbox').checked = res.sendErrors;
		})();

	})();
});
