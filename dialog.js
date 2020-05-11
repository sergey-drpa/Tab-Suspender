/*
 * Copyright (c) 2015 Sergey Zadorozhniy. The content presented herein may not, under any circumstances, 
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */
 
(function()
{
	"use strict";

	window.focus();
	var overlay = document.querySelector('.overlay');
	var closeDialog;

    var baseUrl = parseUrlParam('url');
    var dialogMode = parseUrlParam('dialog');
    var separateTab = parseUrlParam('separate_tab');
    var requesterTabId = parseUrlParam('requester_tab_id');

    if(separateTab == 'true')
    	overlay.classList.add("separateTab");

	var closeSeparateTab;
    function closeDialog() {
        chrome.runtime.sendMessage({method: "[AutomaticTabCleaner:hideDialog]"}, closeSeparateTab=function(response){
            if(separateTab == 'true') {
                chrome.tabs.update(parseInt(requesterTabId), {active: true});
                chrome.tabs.remove(response.tabId);
            }
        });
    }

    if(separateTab != 'true')
    	overlay.addEventListener('click', closeDialog);
	
	document.querySelector('#cancelButton').addEventListener('click', closeDialog);

    var addWhitelistHandler;
    document.getElementById("addButton").addEventListener('click', addWhitelistHandler=function() {
        chrome.runtime.sendMessage({method: "[AutomaticTabCleaner:addToWhiteList]", hideDialog: true, pattern: constructUrl({'final': true})}, closeSeparateTab);
    });

	document.onkeydown = function(evt) 
	{
		evt = evt || window.event;
		if (evt.keyCode == 27) {
			closeDialog();
		}
		else if(evt.keyCode == 13)
            addWhitelistHandler();
	};

	document.getElementById("pattern").value = baseUrl;
   
    var parser = document.createElement('a');
	parser.href = baseUrl;
	
	/*parser.host;     // => "example.com:3000"
	parser.pathname; // => "/pathname/"
	parser.search;   // => "?search=test"
	parser.hash;     // => "#hash"*/
	
	var subDomains = parser.host.split('.');
	var subPaths = [];
	var pathname = parser.pathname;
	if(pathname.length > 0)
	{
		if(pathname.substr(0,1) == "/")
			pathname = pathname.substr(1);
		if(pathname.length > 1 && pathname.substr(pathname.length-1) == "/")
			pathname = pathname.substr(0, pathname.length-1);
	}
	if( pathname != "" && pathname != "/" )
		subPaths = pathname.split('/');

    var siteSlider = document.getElementById("siteSlider");
    var pageSlider = document.getElementById("pageSlider");
	
	document.getElementById("pattern").value = constructUrl();//"*"+subDomains.join('.')+(subPaths.length>0?"/":"")+subPaths.join("/")+"/*";
	
	if(subDomains.length >= 3)
	{
		siteSlider.style.display="";
		siteSlider.max = subDomains.length - 2;
		siteSlider.addEventListener('input', function(arg) {
		  console.log(this.value, this, arg);
		  document.getElementById("pattern").value = constructUrl();
		});
	}
	else
	{
		siteSlider.style.display="none";
		document.getElementById("siteSliderSpan").style.display="none";
	}
		
	
	if(subPaths.length > 0)
	{
		pageSlider.style.display="";
        pageSlider.max = subPaths.length;
        pageSlider.value = 0;
		pageSlider.addEventListener('input', function(arg) {
		  console.log(this.value, this, arg);
		  document.getElementById("pattern").value = constructUrl();
		});
	}
	else
	{
		pageSlider.style.display="none";
		document.getElementById("pageSliderSpan").style.display="none";
	}

	function constructUrl(options)
	{
		"use strict";
		
		var domain;
		if(subDomains.length > 2)
		{
			var subSubDomains = subDomains.slice(siteSlider.value/*,subDomains.length-1*/);
			domain = subSubDomains.join(".");
			/*var misedSpaces = subDomains.join('.').length-domain.length;
			for(var i=0;i<misedSpaces;i++)
				domain = " "+domain;*/
		}
		else
			domain = subDomains.join('.');
			
		var path;
		if(subPaths.length > 0)
		{
			if(subPaths != null)
			{
                var subSubPath = subPaths.slice(0, pageSlider.value);
                path = subSubPath.join("/");
            }
            else
            	path = "/";
		}
		else
			path = subPaths.join('/');
		
		return "*"+domain+(path?"/":"")+path+(!options || options['final'] == false ? "/" : "")+"*";
	}
	/************************/
	/*		Util Methods    */
	/************************/
	
	function parseUrlParam(val) {
		"use strict";
		
		var tmp = [];
		var parts = window.location.search.substr(1).split("&");

		for(var i =0; i<parts.length;i++){
			tmp = parts[i].split("=");
			if (tmp[0] === val)
				return decodeURIComponent(tmp[1]);
		} 
	}
})();