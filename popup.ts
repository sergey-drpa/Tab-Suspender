/* eslint-env jquery */
/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

'use strict';

(()=>{

	let currentTab, pauseTics, pauseTicsStartedFrom, ignodeCurrentTabChecked = false, tabInWhiteList = false;
	let popupQueryBGResponse: PopupQueryBGResponse;


	/***window.******************************
	 **************** ONLOAD ****************
	 ****************************************/

	let showSessions = true;
	if(parseUrlParam(location.href, "showSessions")==="no") {
		showSessions = false;
	}

	$(window).load(function() {
		document.getElementById("slider").focus();
		document.getElementById("main-slider").focus();
	});

	document.addEventListener('DOMContentLoaded', function() {

		const isDarkModeEnabled = isDarkMode();

		if(isDarkModeEnabled) {
			const style = `<style>
					body { background-color: #222; }
					hr { background-color: #505050 !important; }
					.slider-background { background-color: #656565; }
					.menu { color: #cccccc !important; }
					.irs-line { background: linear-gradient(to bottom, #8e8e8e -50%, #fff 150%); }
					div.menu:hover:not(.disabled) { background-color: #585858; }
					.recicle-section { background-color: #383838; border: 1px #545454 solid; }
					.tab-button { border-bottom: 2px solid #222;}
					.tab-button.visible { background-color: #383838; border: 1px #545454 solid; border-bottom: 1px #383838 solid; }
					.inline-btn { color: #eaeaea; }
					.menu:hover .inline-btn.disabled { background-color: #fff; border: solid 1px #f7f7f7; color: #a9aeaf; opacity: 0.6; }
					.sessionManagerLinkNew { filter: brightness(3.5); }
					.button { color: #ececec; }
			</style>`;
			$('html > head').append($(style));
		}

		trackErrors('popup', true);

		document.getElementsByTagName('body')[0].className = chrome.i18n.getMessage('@@ui_locale');
		//BG = chrome.extension.getBackgroundPage();

		chrome.tabs.query({ currentWindow: true, active: true }, async function(tabs) {
			try {
				currentTab = tabs[0];
				//let manifest = chrome.runtime.getManifest();


				const res: PopupQueryBGResponse = popupQueryBGResponse = await chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:popupQuery]', tab: currentTab });


				if (res.isTabInIgnoreTabList) {
					ignodeCurrentTabChecked = true;
					document.querySelector('#ignodeCurrentTab').className = 'menu checked';
				}

				if (res.isTabInWhiteList) {
					tabInWhiteList = true;
					$('#addToWhilelist').addClass('checked');
				}

				if (!res.allowed) {
					$('#suspend').addClass('disabled');
				}

				recalculatePauseStatus();

				if (res.active != null) {
					// @ts-ignore
					$('#tabSuspenderActive').attr('checked', res.active);
					changePausedUI(!res.active);
				}

				if (res.isCloseTabsOn) {
					$('#recicleTab').prop('checked', true);
					$('.tab-button').addClass('checked');
				} else {
					$('#recicleTab').prop('checked', false);
					$('.tab-button').removeClass('checked');
				}

				if (res.popup_showWindowSessionByDefault && showSessions) {
					$('#showWindowSessionByDefault').prop('checked', true);
					setTimeout(()=>{ toggleShowWindowSessions(true); }, 10 );
				}

				if(!showSessions) {
					document.getElementById("sessionSection").style.display = 'none';
				}

				if (tabs[0].url.indexOf(chrome.runtime.getURL('park.html')) == 0)
					suspBtnSetSusp('#suspend');


				// Pause
				pauseTics = res.pauseTics;
				pauseTicsStartedFrom = res.pauseTicsStartedFrom;

				if (pauseTics > 0)
					if (pauseInterval == null)
						pauseInterval = setInterval(function() {
							pauseTics--;
							recalculatePauseStatus();
						}, 1000);


				const sliderDisabled = false;
				/*if (tabs[0].url != null && tabs[0].url == chrome.runtime.getURL(manifest.options_page)) {
					sliderDisabled = true;
					document.querySelector('#settings').className = 'menu disabled';
				} else*/


				if (res.timeout != null) {
					slider.update({ from: res.timeout, min: 0, max: Math.ceil(res.timeout/3600)*2*3600, from_min: 60, step: 60, disable: sliderDisabled });
					/*if (res.timeout > 3600)
						slider.update({ from: res.timeout, min: 0, max: 21600, from_min: 60, step: 60, disable: sliderDisabled });
					else
						slider.update({ from: res.timeout, min: 0, max: 3600, from_min: 60, step: 60, disable: sliderDisabled });*/
				}

				if (res.closeTimeout != null) {
					//if (res.closeTimeout > 10800)
						sliderRecycleAfter.update({ from: res.closeTimeout, max: Math.ceil(res.closeTimeout/3600)*2*3600, disable: !res.isCloseTabsOn });
					//else
						//sliderRecycleAfter.update({ from: res.closeTimeout, max: 10800, disable: !res.isCloseTabsOn });
				}

				if (res.limitOfOpenedTabs != null)
					sliderRecycleKeep.update({ from: res.limitOfOpenedTabs, disable: !res.isCloseTabsOn });

				document.getElementById('versionSpan').innerText = 'v' + res.TSVersion;

				if (debug)
					document.getElementById('tabId').textContent = String(res.tabId);
			} catch (e) {
				console.error(e);
				chrome.runtime.sendMessage({
					method: '[AutomaticTabCleaner:trackError]',
					message: 'Error in Popup' + e.message,
					stack: e.stack
				}).catch(console.error);
			}
		});

		function secondsHumanise(seconds) {
			if(seconds===0){
				return '0 min';
			}
			const numDays = Math.floor((seconds / 86400));
			const numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
			const numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
			const numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
			return '   ' + (numDays > 0 ? numDays + ' day ' : '') + (numhours > 0 ? numhours + ' hour ' : '') + (numminutes > 0 ? numminutes + ' min ' : '') + (numseconds > 0 && numminutes <= 10 ? numseconds + ' sec' : '');
		}

		// eslint-disable-next-line prefer-const
		let slider;
		// eslint-disable-next-line prefer-const
		let sliderRecycleAfter;
		// @ts-ignore
		$('.js-range-slider').ionRangeSlider({
			grid: true,
			min: 0,
			max: 3600*24,
			from_min: 60,
			step: 60,
			hide_min_max: true,
			/*from: 60,
			from_max: 86400,*/
			//hide_from_to: true,
			keyboard: true,
			keyboard_step: 1.1,
			prettify_enabled: true,
			prettify: function(seconds) {
				//let numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
				//let numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);

				const result = secondsHumanise(seconds);
				/*if (this.max > 3600)
					result = numhours + ' h ' + (numminutes > 0 ? (numminutes < 10 ? numminutes + '0' : numminutes) + ' min' : '');
				else
					result = (numhours > 0 ? numhours + ' hour' : '') + (numhours < 1 || numhours > 1 && numminutes > 0 ? numminutes + ' min' : '');*/

				setTimeout(function() {
					updateJsRangeSliderTitle(result);
				}, 100);

				if(slider) {
					console.log(slider.old_from);
					if (slider.old_from === this.max) {
						adjustSlider(slider, this.max * 2)
					}
				}

				return result;
			},
			onFinish: function(data) {
				console.log('onFinish', data);
				//if (data.from > 1300 && this.max === 3600) {
				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', timeout: data.from }).catch(console.log);
			}
		});

		function adjustSlider(slider, targetMax) {
			setTimeout(() => {
				const startedMax = slider.options.max;
				const steps = 30;
				const step = (targetMax - startedMax) / steps;
				let iteration = 0;
				const interval = setInterval(function() {
					iteration++;
					if (iteration === steps) {
						clearInterval(interval);
						slider.update({ max: targetMax });
					} else
						slider.update({ max: startedMax + step * iteration });
				}, 30);
			}, 0);
		}

		document.getElementById('increaseSliderInterval').onclick = () => {
			adjustSlider(slider, slider.options.max * 2)
		}
		document.getElementById('increaseSliderRecicleAfterInterval').onclick = () => {
			adjustSlider(sliderRecycleAfter, sliderRecycleAfter.options.max * 2)
		}

		function updateJsRangeSliderTitle(time) {
			$('.js-range-slider').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('autoSuspendSliderValue', [time]));
			$('.js-range-slider').parent().find('.irs-slider.single').attr('title', chrome.i18n.getMessage('autoSuspendSliderValue', [time]));
		}

		// @ts-expect-error
		$('.js-range-slider-recicle-after').ionRangeSlider({
			grid: false,
			force_edges: true,
			min: 0,
			max: 86400,
			from_min: 60,
			step: 60,
			hide_min_max: true,
			keyboard: true,
			keyboard_step: 0.5,
			prettify_enabled: true,
			prettify: function(seconds) {
				/*let numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
				let numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);

				let result = (numhours > 0 ? numhours + ' h ' : '') + (numminutes > 0 ? numminutes + ' min ' : '');*/
				const result = secondsHumanise(seconds);
				setTimeout(function() {
					updateRecycleAfterSliderTitle(result);
				}, 100);

				if(sliderRecycleAfter) {
					console.log(sliderRecycleAfter.old_from);
					if (sliderRecycleAfter.old_from === this.max) {
						adjustSlider(sliderRecycleAfter, this.max * 2)
					}
				}

				return 'Can close tabs after <b style=\'font-size: 11px;\'>' + result + '</b> of tab inactivity';
			},
			onFinish: function(data) {
				console.log('onFinish', data);

				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', closeTimeout: data.from }).catch(console.error);
			}
		});

		function updateRecycleAfterSliderTitle(time) {
			$('.js-range-slider-recicle-after').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('recycleAfterSliderValue', [time]));
		}

		// @ts-expect-error
		$('.js-range-slider-recicle-keep').ionRangeSlider({
			grid: false,
			force_edges: true,
			min: 0,
			max: 300,
			from_min: 1,
			step: 1,
			hide_min_max: true,
			keyboard: true,
			keyboard_step: 0.9,
			prettify_enabled: true,
			prettify: function(seconds) {

				setTimeout(function() {
					updateRecycleKeepSliderTitle(seconds);
				}, 100);

				return '...and only when window have more than <b style=\'font-size: 11px;\'>' + seconds + '</b> opened tabs';
			},
			onFinish: function(data) {

				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', limitOfOpenedTabs: data.from }).catch(console.error);
			}
		});

		function updateRecycleKeepSliderTitle(time) {
			$('.js-range-slider-recicle-keep').parent().find('.irs-single').attr('title', chrome.i18n.getMessage('recycleKeepSliderValue', [time]));
		}


		const elementsWithLocalTitles = document.querySelectorAll('[title^="__MSG_"]');
		for (const i in elementsWithLocalTitles)
			if (elementsWithLocalTitles.hasOwnProperty(i)) {
				// @ts-expect-error
				const titleKey = elementsWithLocalTitles[i].title;
				if (titleKey != null)
					// @ts-expect-error
					elementsWithLocalTitles[i].title = chrome.i18n.getMessage(titleKey.substr(6, titleKey.length - 8));
			}

		function renderPreviews() {
			document.getElementById('previewsBar').innerHTML = '';

			chrome.windows.getCurrent({ 'populate': true }, function(window) {
				const windows = [window];
				const parkUrl = chrome.runtime.getURL('park.html');
				const sessionsUrl = chrome.runtime.getURL('sessions.html');
				const TSSessionId = popupQueryBGResponse.TSSessionId;

				for (const wi in windows) {
					if (windows.hasOwnProperty(wi)) {
						//let tabs = [];
						for (const j in windows[wi].tabs)
							if (windows[wi].tabs.hasOwnProperty(j)) {
								const tab = windows[wi].tabs[j];
								if (tab.url.indexOf(sessionsUrl) == 0)
									continue;
								const parked = tab.url.indexOf(parkUrl) == 0;
								const tabMeta = {
									title: tab.title,
									url: (parked ? parseUrlParam(tab.url, 'url') : tab.url),
									tabId: (parked ? parseUrlParam(tab.url, 'tabId') : tab.id),
									sessionId: (parked ? parseUrlParam(tab.url, 'sessionId') : TSSessionId),
									nativeTabId: tab.id,
									nativeWindowId: windows[wi].id
								};

								// @ts-ignore
								const divLine: HTMLDivElement = drawPreviewTile(tabMeta, {
									noTime: true,
									//close: true,
									noHref: true,
									noTitle: true,
									noUrl: true,
									popuped: true,
								});

								(divLine.getElementsByClassName('card-img-a')[0] as HTMLDivElement).onclick = function() {
									//e.stopPropagation();
									chrome.windows.update(tabMeta.nativeWindowId, { focused: true }, function() {
										console.log('window Updated');
									});
									chrome.tabs.update(tabMeta.nativeTabId, { active: true }, function() {
										console.log('tab Updated');
									});
									return false;
								};

								let mousePosition;
								(divLine.getElementsByClassName('card-img-a')[0] as HTMLDivElement).onmousemove = function(e: MouseEvent) {
									//console.log(e);
									if ((e.target as HTMLDivElement).classList.contains('zoom')) {
										if (!mousePosition) {
											mousePosition = [e.movementX, e.movementY];
										} else {
											mousePosition[0] -= e.movementX;
											mousePosition[1] -= e.movementY;
										}
										// @ts-expect-error
										e.target.style.setProperty("transform", `scale(2.5) translateX(${parseInt(mousePosition[0]*1.4)}px)`, "important")
									} else {
										mousePosition = null;
										(e.target as HTMLDivElement).style.transform = "";
									}
									return null;
								}

								/*(divLine.getElementsByClassName('card-img-a')[0] as HTMLDivElement).onmouseout = function(e: MouseEvent) {
									//e.target.style.transform = "";
									return null;
								}*/

								document.getElementById('previewsBar').appendChild(divLine);
							}
					}
				}
			});
		}

		let activeSessionsIsOpen = false;

		function toggleShowWindowSessions(value?) {
			const previewBar = document.getElementById('previewsBar');
			if (!activeSessionsIsOpen || value) {
				activeSessionsIsOpen = true;
				renderPreviews();
				previewBar.style.setProperty('display', 'block');
			} else {
				activeSessionsIsOpen = false;
				previewBar.style.setProperty('display', 'none');
			}
		}

		document.getElementById("activeSessionsButton").onclick = () => {
			toggleShowWindowSessions();
		};


		/* Dom Listeners... */
		slider = $('.js-range-slider').data('ionRangeSlider');
		sliderRecycleAfter = $('.js-range-slider-recicle-after').data('ionRangeSlider');
		const sliderRecycleKeep = $('.js-range-slider-recicle-keep').data('ionRangeSlider');


		/********************* BINDING EVENTS *******************/


		// @ts-ignore
		document.querySelector('#settings').onclick = function(options) {

			const manifest = chrome.runtime.getManifest();
			focusOrOpenTSPage(manifest.options_page, options);

			/*let extviews = chrome.extension.getViews();

			for (let i = 0; i <= extviews.length; i++) {
				if (extviews[i] && extviews[i].location.href == chrome.runtime.getURL(manifest.options_page)) {
					extviews[i].chrome.tabs.getCurrent(function(tab) {
						chrome.tabs.reload(tab.id, {});
						if (options == null || options.reloadOnly == null || options.reloadOnly == false)
							chrome.tabs.update(tab.id, { 'active': true });
						chrome.windows.update(tab.windowId, { focused: true });
					});
					break;
				} else if (i == extviews.length - 1) {
					// Create new tab if past end of list and none open
					if (options == null || options.reloadOnly == null || options.reloadOnly == false)
						chrome.tabs.create({ 'url': manifest.options_page, 'active': true });
				}
			}*/
			return false;
		};

		// @ts-ignore
		document.querySelector('#suspendHistory').onclick = function(options) {
			focusOrOpenTSPage('history.html#suspended', options);
			return false;
		};

		// @ts-ignore
		document.querySelector('#closeHistory').onclick = function(options) {
			focusOrOpenTSPage('history.html#closed', options);
			return false;
		};

		// @ts-ignore
		document.querySelector('#sessionManager').onclick = document.querySelector('#sessionManagerLink').onclick = function(options) {
			focusOrOpenTSPage('sessions.html', options);
			return false;
		};

		// @ts-ignore
		document.querySelector('#hotkeys').onclick = function() {
			chrome.tabs.create({ 'url': 'chrome://extensions/configureCommands' }, function() {
			});
		};

		// @ts-ignore
		document.querySelector('#suspend').onclick = function() {
			if (document.querySelector('#suspend').className.indexOf('disabled') == -1)
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {

					if (debug)
						console.log(tabs[0]);

					chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:suspendTab]', tab: tabs[0] }, function() {
						suspBtnSetSusp('#suspend');
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		// @ts-ignore
		document.querySelector('#suspendWindow').onclick = function() {

			if (document.querySelector('#suspendWindow').className.indexOf('disabled') == -1)
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:suspendWindow]', tab: tabs[0] }, function() {
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		// @ts-ignore
		document.querySelector('#suspendAllOther').onclick = function() {
			if (document.querySelector('#suspendAllOther').className.indexOf('disabled') == -1)
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					chrome.runtime.sendMessage({
						method: '[AutomaticTabCleaner:suspendAllOtherTabs]',
						tab: tabs[0]
					}, function() {
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		let suspendAllButton;
		// @ts-ignore
		(suspendAllButton=document.querySelector('#suspendAll')).onclick = function() {
			if (suspendAllButton.className.indexOf('disabled') == -1)
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					chrome.runtime.sendMessage({
						method: '[AutomaticTabCleaner:suspendAllTabs]'
					}, function() {
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		// @ts-ignore
		document.querySelector('#unsuspendAll').onclick = function() {
			if (document.querySelector('#unsuspendAll').className.indexOf('disabled') == -1)
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:unsuspendAllTabs]', tab: tabs[0] }, function() {
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		// @ts-ignore
		document.querySelector('#unsuspendWindow').onclick = function() {

			if (document.querySelector('#unsuspendWindow').className.indexOf('disabled') == -1)
				chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
					chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:unsuspendWindow]', tab: tabs[0] }, function() {
						setTimeout(function() {
							window.close();
						}, 300);
					});
				});
		};

		document.getElementById('addToWhilelist').onclick = function() {
			if (tabInWhiteList)
				return;

			chrome.tabs.query({ currentWindow: true, active: true }, function(tabs) {
				if (tabs[0].url.includes('//chrome.google.com')) {
					chrome.tabs.create({
						windowId: tabs[0].windowId,
						index: tabs[0].index + 1,
						url: chrome.runtime.getURL('dialog.html') + '?separate_tab=true&requester_tab_id=' + tabs[0].id + '&url=' + encodeURIComponent(tabs[0].url)
					}).catch(console.error);

				} else
					chrome.tabs.sendMessage(tabs[0].id, {
						'method': '[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]',
						'tab': tabs[0]
					}, function() {
					});
			});

			setTimeout(function() {
				window.close();
			}, 300);
		};

		document.getElementById('donate').onclick = function() {

			chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:donate]' }).catch(console.error);
			setTimeout(function() {
				window.close();
			}, 300);

			return false;
		};

		// @ts-ignore
		document.querySelector('#pause-first-btn').onclick = function() {
			pause(600);
		};
		// @ts-ignore
		document.querySelector('#pause-second-btn').onclick = function() {
			pause(3599);
		};
		// @ts-ignore
		document.querySelector('#pause-third-btn').onclick = function() {
			pause(3600 * 5);
		};
		// @ts-ignore
		document.querySelector('#pause-forth-btn').onclick = function() {
			pause(3600 * 24);
		};
		// @ts-ignore
		document.querySelector('#resetPauseTimer').onclick = function() {
			pause(0);
		};


		document.getElementById('removePageFromWhitelist').onclick = function() {

			chrome.runtime.sendMessage({
				method: '[AutomaticTabCleaner:removeUrlFromWhitelist]',
				url: currentTab.url
			}, function() {
			});

			window.close();
			return false;
		};


		// @ts-ignore
		document.querySelector('#progress-bar').onclick = function() {

			chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:pause]', pauseTics: 0 }, function(res) {
				document.querySelector('#pause').className = 'menu menu-inline';

				pauseTics = res.pauseTics;
				pauseTicsStartedFrom = res.pauseTics;
				recalculatePauseStatus();
			});
		};

		// @ts-ignore
		document.querySelector('#ignodeCurrentTab').onclick = function() {

			if (ignodeCurrentTabChecked)
				chrome.runtime.sendMessage({
					method: '[AutomaticTabCleaner:ignoreTab]',
					tabId: currentTab.id,
					action: 'remove'
				}, function() {
					ignodeCurrentTabChecked = false;
					document.querySelector('#ignodeCurrentTab').className = 'menu';
				});
			else
				chrome.runtime.sendMessage({
					method: '[AutomaticTabCleaner:ignoreTab]',
					tabId: currentTab.id,
					action: 'add'
				}, function() {
					ignodeCurrentTabChecked = true;
					document.querySelector('#ignodeCurrentTab').className = 'menu checked';
				});
		};

		/* Tab Suspender Active Checkbox */
		let tabSuspenderActiveCheckbox;
		// @ts-ignore
		(tabSuspenderActiveCheckbox=document.querySelector('#tabSuspenderActive')).onchange = function() {
			chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', isTabSuspenderActive: tabSuspenderActiveCheckbox.checked }).catch(console.error);
			changePausedUI(!tabSuspenderActiveCheckbox.checked);
		};


		/** RECICLE POPUP LOGIC */
		let recicleTabCheckbox;
		// @ts-ignore
		(recicleTabCheckbox = document.querySelector('#recicleTab')).onchange = function() {
			if (recicleTabCheckbox.checked) {
				$('.tab-button').addClass('checked');
				sliderRecycleAfter.update({ disable: false });
				sliderRecycleKeep.update({ disable: false });

				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', isCloseTabsOn: true }).catch(console.error);
			} else {
				$('.tab-button').removeClass('checked');
				sliderRecycleAfter.update({ disable: true });
				sliderRecycleKeep.update({ disable: true });

				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', isCloseTabsOn: false }).catch(console.error);
			}
		};

		let showWindowSessionByDefaultCheckbox;
		// @ts-ignore
		(showWindowSessionByDefaultCheckbox = document.querySelector('#showWindowSessionByDefault')).onchange = function() {
			if (showWindowSessionByDefaultCheckbox.checked) {
				toggleShowWindowSessions(true);
			}
				chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:updateTimeout]', popup_showWindowSessionByDefault: showWindowSessionByDefaultCheckbox.checked }).catch(console.error);
		};

		let focus = false;
		// @ts-ignore
		document.querySelector('.tab-button').onclick = /*document.querySelector('.recicle-section').onmouseover =*/ function() {
			$('.recicle-section').addClass('visible');
			$('.tab-button').addClass('visible');
		};

		$('#recicleTab').click(function(event) {
			focus = false;
			event.stopPropagation();
		});
		let tabButtonLinkClick;
		$('.tab-button-link').click(tabButtonLinkClick = function(event) {
			if ($('.tab-button').hasClass('visible') && event != null) {
				//console.log('2', event);
				focus = false;
				$('.recicle-section').removeClass('visible');
				$('.tab-button').removeClass('visible');
			} else {
				$('.recicle-section').addClass('visible');
				$('.tab-button').addClass('visible');
			}

			if (event != null)
				event.stopPropagation();
		});

		$('.tab-button, .recicle-section').focusin(function() {
			//console.log('3');
			focus = true;
			console.log('Focus!');
		});

		// @ts-ignore
		const focusOutHandler = document.querySelector('.tab-button').onmouseout = document.querySelector('.recicle-section').onmouseout = function(event?) {
			if (!event)
				return;

			if (focus)
				return;

			if (event && event.relatedTarget && ($(event.relatedTarget).hasClass('tab-button') || $(event.relatedTarget).parents('.tab-button').length > 0 || $(event.relatedTarget).hasClass('recicle-section') || $(event.relatedTarget).parents('.recicle-section').length > 0))
				return;

			//console.log('4');

			$('.recicle-section').removeClass('visible');
			$('.tab-button').removeClass('visible');
		};

		$('.tab-button, .recicle-section').focusout(function() {
			console.log('FocusOut!');
			setTimeout(function() {
				focus = false;
				focusOutHandler();
			}, 100);
		});

		let timeoutId;
		$('.tab-button').hover(function() {
				if (!$('.tab-button').hasClass('visible'))
					if (!timeoutId) {
						timeoutId = window.setTimeout(function() {
							timeoutId = null; // EDIT: added this line
							tabButtonLinkClick(null);
						}, 300);
					}
			},
			function() {
				if (timeoutId) {
					window.clearTimeout(timeoutId);
					timeoutId = null;
				}
			});
	});


	/************************************
	 **************** UTILS **************
	 *************************************/


	const secondsFormater = function(seconds) {
		const numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
		const numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
		const numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
		return '   ' + (numhours > 0 ? numhours + ' hours ' : '') + (numminutes > 0 ? ' ' + numminutes + ' min' : '') + (numseconds > 0 && numhours <= 0 ? ' ' + numseconds + ' sec' : '');
	};

	function suspBtnSetSusp(selector) {
		document.querySelector(selector).className = 'inline-btn disabled parked';
		document.querySelector(selector).text = 'Suspended';
	}

	function recalculatePauseStatus() {
		if (pauseTics > 0 && pauseTicsStartedFrom > 0) {
			const width = parseInt(document.body.style.width);
			const pxPerProc = (width / 100);
			const procent = (pauseTics / (pauseTicsStartedFrom / 100));
			// @ts-ignore
			document.querySelector('.progress-bar').style.width = procent * pxPerProc + 'px';
			// @ts-ignore
			document.querySelector('.progress-bar').style.left = 0;

			document.querySelector('.progress-bar span').innerHTML = secondsFormater(pauseTics);
		} else {
			// @ts-ignore
			document.querySelector('.progress-bar').style.width = '0px';
			document.querySelector('.progress-bar span').innerHTML = '';
		}

		//let sliders = document.querySelectorAll('#slider');
		if (pauseTics > 0) {
			document.querySelector('#pause').className = 'menu stage2';
			document.querySelector('#pause .menu').innerHTML = 'Suspender Paused for:';
			changePausedUI(true);
			/*for (let i in sliders)
				if (sliders.hasOwnProperty(i))
					sliders[i].className = 'disabled';*/
		} else {
			document.querySelector('#pause').className = 'menu ';
			document.querySelector('#pause .menu').innerHTML = 'Pause Suspender:';
			changePausedUI(false);
			/*for (let j in sliders)
				if (sliders.hasOwnProperty(j))
					sliders[j].className = '';*/
			clearInterval(pauseInterval);
			pauseInterval = null;
		}
	}

	function changePausedUI(paused) {

		if(paused) {
			document.getElementById('link').classList.add('disabled');
		} else {
			document.getElementById('link').classList.remove('disabled');
		}

		const sliders = document.querySelectorAll('#slider');

		for (const i in sliders)
			if (sliders.hasOwnProperty(i))
				if(paused){
					sliders[i].className = 'disabled';
				} else {
					sliders[i].className = '';
				}
	}

	let pauseInterval = null;

	function pause(period) {
		chrome.runtime.sendMessage({ method: '[AutomaticTabCleaner:pause]', pauseTics: period }, function(res) {
			document.querySelector('#pause').className = 'menu menu-inline disabled';

			pauseTics = res.pauseTics;
			pauseTicsStartedFrom = res.pauseTics;
			recalculatePauseStatus();
		});

		if (pauseInterval == null)
			pauseInterval = setInterval(function() {
				pauseTics--;
				recalculatePauseStatus();
			}, 1000);
	}
})();


