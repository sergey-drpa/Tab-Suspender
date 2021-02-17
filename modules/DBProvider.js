/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 *
 */
// eslint-disable-next-line no-redeclare
function DBProvider(dbImplementation, options) {
	'use strict';

	this.concreteDBProvider = null;

	if (dbImplementation == 'WebSQl')
		// eslint-disable-next-line no-undef
		this.concreteDBProvider = new WebSQlProvider(options);
	else if (dbImplementation == 'IndexedDB')
		// eslint-disable-next-line no-undef
		this.concreteDBProvider = new IndexedDBProvider(options);
	else
		// eslint-disable-next-line no-undef
		this.concreteDBProvider = new IndexedDBProvider(options);
}

/**
 *
 */
DBProvider.prototype.isInitialized = function() {
	return this.concreteDBProvider.initialized;
};


/**
 *
 */
DBProvider.prototype.getInitializedPromise = function() {
	return this.concreteDBProvider.initializedPromise;
};

/**
 *
 */
DBProvider.prototype.getAll = function(tableName, callback, errorCallback) {
	return this.concreteDBProvider.getAll(tableName, callback, errorCallback);
};

/**
 *
 */
DBProvider.prototype.queryIndex = function(query, callback) {
	return this.concreteDBProvider.queryIndex(query, callback);
};

/**
 *
 */
DBProvider.prototype.queryIndexCount = function(query, callback) {
	return this.concreteDBProvider.queryIndexCount(query, callback);
};

/**
 *
 */
DBProvider.prototype.put = function(query) {
	return this.concreteDBProvider.put(query);
};

/**
 *
 */
DBProvider.prototype.putV2 = function(queries) {
	return this.concreteDBProvider.putV2(queries);
};

/**
 *
 */
DBProvider.prototype.executeDelete = function(query) {
	return this.concreteDBProvider.executeDelete(query);
};

/**
 *
 */
DBProvider.prototype.open = function(options) {
	return this.concreteDBProvider.open(options);
};
