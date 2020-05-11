/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

document.addEventListener('DOMContentLoaded', function (){
    window.focus();
}, true);

(function(){
    "use strict";

	/* Genaral */
	var storageTabScreenPrefix = 'ATCSTab';
	var WIZARD_FRAME_ID = "ATCSDialogWizadriFrame";
	var ADD_TO_WHITELIST_FRAME_ID = "ATCSDialogiFrame";
	var waitWindow = 1000;
	var count = 0;
	var debug = false;
	var tabId;

	var notCompleteInputs = [];

    resotreForm();

	/**
	 * Rize event
	 */
    function riseEvent()
    {
		if(count >= 2)
			return false;
        count++;
        return true;
    }

    var changeEventCallback = function()
    {
        chrome.extension.sendMessage({'method':"[AutomaticTabCleaner:TabChangedRequestFromInject]"});
    }

    var onevent = function(e)
    {
		if(riseEvent())
        	dropEvent(e);
    };
	
	function resotreForm()
	{
		chrome.extension.sendMessage({'method':"[AutomaticTabCleaner:getFormRestoreDataAndRemove]"}, function(response) {
			if(response == null)
			{
                return;
            }

			if(window.location.href != response.url)
			{
                return;
            }

            var formDataToRestore = response.formData;

			
			//TODO: Test on this case: http://obraz.pro/register/#registration

            processRestoreForm(formDataToRestore);
		});
	}

	function errorLog(exception)
	{
    	chrome.extension.sendMessage({'method':"[AutomaticTabCleaner:trackError]", message: "Error in Inject: "+(exception? exception.message: ''), stack: (exception ? exception.stack: '')});
	}

    function fireEvent(domElement, eventCode)
	{
        var evt = document.createEvent("HTMLEvents");
        evt.initEvent(eventCode, false, true);
        domElement.dispatchEvent(evt);
	}


	/**
	 * Down event
	 */
	var interval = null;
	var dropEventIntervalController = function ()
    {
        if (count == 0)
        {
        	if(interval != null)
            {
                clearInterval(interval);
                interval = null;
            }
            return;
        }

        count--;

        if (count == 0)
        {
            if(interval != null)
            {
                clearInterval(interval);
                interval = null;
            }
            changeEventCallback();
        }
    };

	function dropEvent(e)
	{
        if(e != null && e.type==="load")
        {
            count--;
            changeEventCallback();
        }
        else
        {
            if (count == 0)
                return;

            if(interval == null)
			{
                interval = setInterval(dropEventIntervalController, waitWindow/2);
			}
        }
	}

    function calcNotCompleteInputsLength(inputs){
    	var totalScore = 0;
        for(var i in notCompleteInputs){
        	if(notCompleteInputs[i].type === 'textarea')
                totalScore += 3;
        	else
                totalScore += 1;
		}
		return totalScore;
	}

	document.body.addEventListener('change', function (e)
		{
			if(e.target.tagName != null && (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'textarea') && e.target.hidden != true)
			{
                if(calcNotCompleteInputsLength(notCompleteInputs) <= 3)
				{
                    for(var i in notCompleteInputs)
                    {
                        if (!document.body.contains(notCompleteInputs[i]) || notCompleteInputs[i].value == null || notCompleteInputs[i].value == '')
                        {
                            var element = notCompleteInputs.splice(i, 1);
                            if (debug)
                                console.log('Input removed: ', element);
                            chrome.extension.sendMessage({'method': "[AutomaticTabCleaner:UnmarkPageAsNonCompleteInput]"});
                        }
                    }
				}

				if(calcNotCompleteInputsLength(notCompleteInputs) > 2)
					return;

				for(var i in notCompleteInputs)				
					if(notCompleteInputs[i] === e.target)
						return;

				if(e.target.value != null && e.target.value != '')
					notCompleteInputs.push(e.target);

				if(calcNotCompleteInputsLength(notCompleteInputs) > 2)
				{
					chrome.extension.sendMessage({'method':"[AutomaticTabCleaner:MarkPageAsNonCompleteInput]"});
					if(debug)
						console.log('Input Changed 3 times: Page Marked As Non Complete');
				}
			}
		}, true);
	
	document.addEventListener("scroll", onevent, true);
	document.addEventListener("click", onevent, true);
	window.addEventListener("resize", onevent, true);
	document.addEventListener("keypress", onevent, true);
	
	//window.addEventListener("load", resotreForm, true);
    window.addEventListener("load", onevent, true);
	
	var suspendedPagesUrls = [];

	chrome.extension.onMessage.addListener(function(request, sender, sendResponse) 
	{
		if (request.method === "[AutomaticTabCleaner:backupSuspendedPagesUrls]") 
		{
			suspendedPagesUrls = request.suspendedUrls;
			console.log('susPgsUrls: ',suspendedPagesUrls.length);
		}
		if (request.method === "[AutomaticTabCleaner:ParkPageFromInject]") 
		{
			var closureTabId = request.tabId;
			var width = request.width;
			var height = request.height;
			/* Try to change origin */
			try{
				var elements = document.getElementsByTagName("img");
				for(var i=0;i<elements.length;i++)
				{
					elements[i].setAttribute('crossOrigin', 'Anonymous');
				}
			} catch (e) {}

			//errorLog(new Error('tabId:'+closureTabId+'req.width: '+width+', window.outerWidth: '+window.outerWidth+' window.outerHeight: '+window.outerHeight));

			if(width!=null)
				document.body.style.width = width+'px';

            html2canvas(document.body, {
                'onrendered': function(canvas) {
                    document.body.appendChild(canvas);

                    var url = chrome.extension.getURL('park.html') + '?title=' + encodeURIComponent(document.title);
                    url += "&url=" + encodeURIComponent(window.location.href);
                    url += "&tabId=" + encodeURIComponent(closureTabId);
                    url += "&sessionId=" + encodeURIComponent(request.sessionId);
                    url += '&icon=' + encodeURIComponent(getOriginalFaviconUrl());

                    chrome.extension.sendMessage(closureTabId + "/" + canvas.toDataURL());

                    chrome.extension.sendMessage({'method':"[AutomaticTabCleaner:ParkPageFromInjectFinished]", 'url':url, 'tabId':closureTabId/*, 'screen': canvas.toDataURL()*/});
                },
                'width': (width!=null ? width : window.outerWidth),//window.innerWidth,
                'height': (window.outerHeight > 0 ? window.outerHeight : height)//window.innerHeight//  //document.height
            });

            sendResponse({'result': 'successful'});
		}
		else if (request.method === "[AutomaticTabCleaner:getOriginalFaviconUrl]")
		{
			sendResponse(getOriginalFaviconUrl());
		}
		else if (request.method === "[AutomaticTabCleaner:highliteFavicon]") 
		{
			setTimeout(function(){ highlite(request.highliteInfo);}, 0);
		}
		else if (request.method === "[AutomaticTabCleaner:HebernateFormData]") 
		{
			sendResponse(hebernateFormData());
		}
		else if (request.method === "[AutomaticTabCleaner:DrawAddPageToWhiteListDialog]") 
		{
			drawAddPageToWhiteListDialog();
		}
		else if (request.method === "[AutomaticTabCleaner:hideDialogRequetToTab]")
		{
			if(document.getElementById(ADD_TO_WHITELIST_FRAME_ID) != null)
                document.getElementById(ADD_TO_WHITELIST_FRAME_ID).parentElement.removeChild(document.getElementById(ADD_TO_WHITELIST_FRAME_ID));
            if(document.getElementById(WIZARD_FRAME_ID) != null)
                document.getElementById(WIZARD_FRAME_ID).parentElement.removeChild(document.getElementById(WIZARD_FRAME_ID));

            document.getElementsByTagName("body")[0].style.filter = "";
			window.focus();
		}
        else if (request.method === "[AutomaticTabCleaner:DrawSetupWizardDialog]")
        {
            drawSetupWizardDialog();
        }
	});

	/************************************/
	/*	     DrawSetupWizardDialog      */
	/************************************/


    function drawSetupWizardDialog ()
    {
        if(document.getElementById(WIZARD_FRAME_ID))
            return;

        document.getElementsByTagName("body")[0].style.filter = "blur(1px)";

        var iframe = document.createElement('iframe');
        iframe.id = WIZARD_FRAME_ID;
        iframe.src = chrome.extension.getURL("wizard.html?dialog=page&url="+document.location.href);
        iframe.style.position = 'fixed';
        iframe.style.top = '0px';
        iframe.style.left = '0px';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.zIndex = 10000000;
        iframe.frameBorder = 0;
        document.getElementsByTagName("html")[0].appendChild(iframe);
    }

	/************************************/
	/*	   AddPageToWhiteListDialog     */
	/************************************/

	
	function drawAddPageToWhiteListDialog()
	{
		if(document.getElementById(ADD_TO_WHITELIST_FRAME_ID))
			return;
			
		document.getElementsByTagName("body")[0].style.filter = "blur(1px)";
		
		var iframe = document.createElement('iframe');
		iframe.id = ADD_TO_WHITELIST_FRAME_ID;
		iframe.src = chrome.extension.getURL("dialog.html?dialog=page&url="+document.location.href);
		iframe.style.position = 'fixed';
		iframe.style.top = '0px';
		iframe.style.left = '0px';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.style.zIndex = 10000000;
		iframe.frameBorder = 0;
		document.getElementsByTagName("html")[0].appendChild(iframe); //document.body.appendChild(iframe);
	}
	
	/************************************/
	/*				FAVICON             */
	/************************************/
	var pi2 = Math.PI * 2;
	var lockImgSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAACXBIWXMAAAsSAAALEgHS3X78AAAA70lEQVQYlU3JP2qFMBwA4CQELeSlprwDlE5WeoAsBUHFtVfQ8zxwkQ5d39DF5R3iba2DFQ+h0CwqiX/SX6dCv/VDAICKorjjnL8GQfDped5bVVVHAEAIAFCSJOcsyy5d173keX5J0/QdABBqmuZRSnnVWt/O84yMMQcp5bWu6yfS973gnOuyLClj7Hg6nRwhxDgMg4fDMDy3bfustf7e950QQhBjTPi+/0GVUg8AgIQQAgAwIQSMMVgpdU8ppYu1FrZt2wEAY4zBWosJIQsdx9Gdpom6rvvzl+u60mmabmgURe2yLAfHcdZ/6cRx/PUL8ROEMEM1AFcAAAAASUVORK5CYII=';
	var faviconInfo = getFaviconInfo();
	var links = faviconInfo.domFavicons;
	var img = new Image();
	
	var originalFaviconUrl;
	var originalCanvas;
	var currentFaviconUrl;
	
	var originalIconUrlBase64;
	
	extractIconBase64();
	window.addEventListener('load', function() { setTimeout(extractIconBase64, 1000); });
	
	function getOriginalFaviconUrl()
	{
		return originalFaviconUrl;
	}


	function extractIconBase64(faviconUrl, retries)
	{
		var xhr = new XMLHttpRequest();
		xhr.open('GET', faviconUrl ? faviconUrl : faviconInfo.faviconUrl, true);

		xhr.responseType = 'arraybuffer';

		xhr.onload = function(e) {
		  if (this.status == 200) {
			var uInt8Array = new Uint8Array(this.response);
			var i = uInt8Array.length;
			var binaryString = new Array(i);
			while (i--)
			{
			  binaryString[i] = String.fromCharCode(uInt8Array[i]);
			}
			var data = binaryString.join('');

			var base64 = window.btoa(data);

			originalIconUrlBase64 = "data:image/png;base64,"+base64;
			prepareIcon();
		  }
		  else
			if(!retries)
				extractIconBase64(chrome.extension.getURL('img/new_page.ico') ,1);

		};

		try {
			xhr.send();
		} catch (e) {
			console.debug(e);
		}
	}
	
	function prepareIcon(highliteInfo) 
	{
		if(currentFaviconUrl != null && highliteInfo == null)
			injectFaviconUrl(currentFaviconUrl);
		else
			generateFaviconUri(highliteInfo);
	}
	
	function injectFaviconUrl (proccesedIcon) 
	{
		currentFaviconUrl = proccesedIcon;
		for(var i=0; i<links.length;i++)
			links[i].href = proccesedIcon;
	}
	
	function generateFaviconUri(callback, highliteInfo)
	{
		img.crossOrigin="anonymous";
		var lockImg = new Image();
		lockImg.crossOrigin="anonymous";
		
		img.onload = function () {			
			lockImg.src = lockImgSrc;
		};
		
		lockImg.onload = function () {
			
			var canvas,ctx;
			
			if(originalCanvas == null)
			{
				canvas = window.document.createElement('canvas');
				canvas.width = 64;
				canvas.height = 64;
				ctx = canvas.getContext('2d');
				
				ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

				originalCanvas = cloneCanvas(canvas);
			}
			else
			{
				canvas = cloneCanvas(originalCanvas);
				ctx = canvas.getContext('2d');
			}
			
			originalFaviconUrl = canvas.toDataURL();
		};
		
		img.src = originalIconUrlBase64 || chrome.extension.getURL('img/new_page.ico');
	}
	
	function highlite (highliteInfo)
	{
        if(originalCanvas == null)
        	return;

		var canvas = cloneCanvas(originalCanvas);
		var ctx = canvas.getContext('2d');
		_highlite(canvas, ctx, highliteInfo);
	}
	
	function _highlite (canvas, ctx, highliteInfo)
	{
		if(highliteInfo != null)
		{
			if(highliteInfo.lock != null)
			{
				ctx.globalAlpha = 0.7;
				ctx.drawImage(lockImg, 9, 7);
			}
			
			applyPercent(ctx, highliteInfo);
		}
			
		injectFaviconUrl(canvas.toDataURL());
	}
	
	/*  Percent  */
	
	function applyPercent(ctx, highliteInfo)
	{
		var percent = highliteInfo.suspendPercent;
		
		ctx.globalAlpha = 1;
		ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, ctx.canvas.width, ctx.canvas.height);
		
		applyGrayScale(ctx, 0.1);
		
		/* BAR STYLE */
		var p = percent/100;
		ctx.globalAlpha = 1;
		ctx.drawImage(img, 0, img.height*p, img.width, img.height*(1-p), 0, ctx.canvas.height*p, ctx.canvas.width, ctx.canvas.height*(1-p));		
	}
	
	/*************************/
	
	window.highlite = highlite;

	function applyGrayScale(ctx, percent)
	{
		if(percent != null)
		{
			var imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.width);
			var data = imageData.data;

			var p = percent;
			for(var i = 0; i < data.length; i += 4) {
			  // red
			  data[i] = data[i]*p + 0.34*(1-p)*data[i] + 0.5*(1-p)*data[i+1] + 0.16*(1-p)*data[i+2];
			  // green
			  data[i + 1] = 0.34*(1-p)*data[i] + data[i+1]*p + 0.5*(1-p)*data[i+1] + 0.16*(1-p)*data[i+2];
			  // blue
			  data[i + 2] = 0.34*(1-p)*data[i] + 0.5*(1-p)*data[i+1] + data[i+2]*p + 0.16*(1-p)*data[i+2];
			}
			
			
			ctx.putImageData(imageData, 0, 0);
		}
	}
	
	function cloneCanvas(oldCanvas) 
	{
		var newCanvas = document.createElement('canvas');
		var ctx = newCanvas.getContext('2d');

		newCanvas.width = oldCanvas.width;
		newCanvas.height = oldCanvas.height;

		ctx.drawImage(oldCanvas, 0, 0);

		return newCanvas;
	}

	function getFaviconInfo ()
	{
		var domFavicons = [];
		var faviconUrl = undefined;

		var nodeList = document.getElementsByTagName("link");

		for (var i = 0; i < nodeList.length; i++)
		{
			if((nodeList[i].getAttribute("rel") === "shortcut icon"))
			{
				faviconUrl = nodeList[i].getAttribute("href");
				domFavicons.push(nodeList[i]);
			}

			if(nodeList[i].getAttribute("rel") === "icon")
				domFavicons.push(nodeList[i]);
		}

		if(faviconUrl == null)
			if(domFavicons.length > 0)
				faviconUrl = domFavicons[0].getAttribute("href");
			else
			{
				var url = window.location.href;
				var arr = url.split("/");
				var result = arr[0] + "//" + arr[2] + '/favicon.ico';
				faviconUrl = result;
			}
			
		return { faviconUrl: faviconUrl, domFavicons: domFavicons };
	}



	function hebernateFormData ()
	{		
		var namedDomInputs;
		var domTextareas;
		var namedDomTextareas;
		var domSelects;
		var namedDomSelects;
		var foundOne;
		var foundSelects;
		var foundTexts;
		var i, j, k, input, name, select, textarea, type, val, len1;
		
		function isVisible (element)
		{
			return element.style.display != "none" && element.style.visibility != "hidden";
		}
	
		var actualInputs;
		var inputs = {};
		var domInputs = document.querySelectorAll('input');
		
		for (var i = 0, len = domInputs.length; i < len; i++)
		{
		  input = domInputs[i];
		  if (!isVisible(input))
			continue;
		  name = input.name;
		  type = input.type;
		  if (name in inputs)
			continue;
		  actualInputs = {};
		  k = 0;
		  foundOne = false; // TODO:....
		  namedDomInputs = document.querySelectorAll('input[name="' + name + '"]');
		  for (var j = 0, len1 = namedDomInputs.length; j < len1; j++)
		  {
			input = namedDomInputs[j];
			++k;
			if (!isVisible(input))
			{
				continue;
			}
			switch (type) {
			  case 'checkbox':
			  case 'radio':
				actualInputs[k] = input.checked ? 'checked' : '';
				if(input.checked)
					foundOne = true;
				break;
			  case 'hidden':
			  	break;
			  case 'password':
				break;
			  default:
				actualInputs[k] = input.value;
				if(input.value != null && input.value != '')
					foundOne = true;
			}
		  }
		  if (foundOne)
			inputs[name] = actualInputs;
		}
	
		var selects = {};
		domSelects = document.querySelectorAll('select');
		for (i = 0, len = domSelects.length; i < len; i++)
		{
		  select = domSelects[i];
		  if (!isVisible(select))
			continue;
		  name = select.name;
		  if (name in selects)
			continue;
		  foundSelects = {};
		  k = 0;
		  foundOne = false;
		  
		  namedDomSelects = document.querySelectorAll('select[name="' + name + '"]');
		  for (j = 0, len1 = namedDomSelects.length; j < len1; j++)
		  {
			select = namedDomSelects[j];
			++k;
			if (!isVisible(select))
			  continue;
			val = select.options[select.selectedIndex].value;
			foundOne = true;
			if (val instanceof Array)
			  foundSelects[k] = val;
			else
			  foundSelects[k] = [val];
		  }
		  if (foundOne)
			selects[name] = foundSelects;
		}
	
		var texts = {};
		domTextareas = document.querySelectorAll('textarea');
		for (i = 0, len = domTextareas.length; i < len; i++)
		{
		  textarea = domTextareas[i];
		  if (!isVisible(textarea))
			continue;
		  name = textarea.name;
		  if (name in texts)
			continue;
		  foundTexts = {};
		  k = 0;
		  foundOne = false;
		  namedDomTextareas =  document.querySelectorAll('textarea[name="' + name + '"]');
		  for (j = 0, len1 = namedDomTextareas.length; j < len1; j++)
		  {
			textarea = namedDomTextareas[j];
			++k;
			if (!isVisible(textarea))
			  continue;
			foundTexts[k] = textarea.value;
			if(textarea.value != null && textarea.value != '')
				foundOne = true;
		  }
		  if (foundOne)
			texts[name] = foundTexts;
		}
	
		var collectedFormData = {
		    timestamp: (new Date()).getTime(),
		    inputs: inputs,
		    texts: texts,
		    selects: selects
		};
		
        if(Object.keys(inputs).length > 0 || Object.keys(texts).length > 0 || Object.keys(selects).length > 0)
		    return collectedFormData;
        else
            return null;
	}

    function processRestoreForm(collectedFormData)
    {
        if (!collectedFormData)
        {
            return false;
        }
        if(Object.keys(collectedFormData).length === 0 && collectedFormData.constructor === Object)
        {
            return false;
        }

        var savedData = JSON.parse(collectedFormData);

        for (var name in savedData.inputs) {
            var inputs = document.querySelectorAll('input[name="' + name + '"]');//$('input[name="' + name + '"]');
            var i = 0;
            for (var _i = 0, _len = inputs.length; _i < _len; _i++) {
                var input = inputs[_i];
                ++i;
                if (i in savedData.inputs[name]) {
                    var val = savedData.inputs[name][i];
                    try {
                        switch (input.type) {
                            case 'checkbox':
                            case 'radio':
                                input.checked = val === 'checked';
                                fireEvent(input,"change");
                                break;
                            case 'text':
                            //case 'password':
                            case 'date':
                            case 'datetime':
                            case 'datetime-local':
                            case 'email':
                            case 'color':
                            case 'month':
                            case 'number':
                            case 'range':
                            case 'tel':
                            case 'url':
                            case 'week':
                                input.value = val;
                                fireEvent(input,"change");
                        }
                    }
                    catch (e)
                    {
                        errorLog(e);
                    }
                }
            }
        }

        for (name in savedData.texts) {
            var savedTexts = savedData.texts[name];
            var texts = document.querySelectorAll('textarea[name="' + name + '"]');
            i = 0;
            for (var _j = 0, _len1 = texts.length; _j < _len1; _j++) {
                var textarea = texts[_j];
                ++i;
                if (i in savedTexts) {
                    try
                    {
                        textarea.value = savedTexts[i];
                        fireEvent(textarea,"change");
                    }
                    catch(e)
                    {
                        errorLog(e);
                    }
                }
            }
        }

        var _results = [];
        for (name in savedData.selects) {
            var savedSelects = savedData.selects[name];
            var selects = document.querySelectorAll('select[name="' + name + '"]');
            i = 0;
            _results.push((function() {
                var _k, _len2, _results1;

                _results1 = [];
                for (_k = 0, _len2 = selects.length; _k < _len2; _k++) {
                    var select = selects[_k];
                    ++i;
                    if (i in savedSelects) {
                        try {
							if(select.value == savedSelects[i])
								continue;
                            select.value = savedSelects[i];
                            fireEvent(select,"change");
                        }
                        catch(e)
                        {
                            errorLog(e);
                        }
                        _results1.push();
                    } else {
                        _results1.push(void 0);
                    }
                }
                return _results1;
            })());
        }
    }	
})();
