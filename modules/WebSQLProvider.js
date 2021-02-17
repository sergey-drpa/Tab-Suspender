/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

/**
 *
 */
function WebSQlProvider(options) {
	'use strict';

	this.db = null;
	this.initialized = false;

	let self = this;
	this.initializedPromise = new Promise(function(resolve, reject) {
		self.initialized = true;
		resolve();
	});

	this.open(options);
}

/**
 *
 */
WebSQlProvider.prototype.getAll = function(query, callback, errorCallback) {
	'use strict';

	this.db.readTransaction(function(tx) {
		tx.executeSql(
			query.WebSQL.query, query.WebSQL.params,
			function(t, results) {
				let resultsRowsArray = [];
				let len = results.rows.length;
				for (let i = 0; i < len; i++)
					resultsRowsArray.push(results.rows.item(i));

				callback(resultsRowsArray);
			},
			errorCallback != null ? errorCallback : sql_error);
	}, errorCallback != null ? errorCallback : sql_error, null);
};

/**
 *
 */
WebSQlProvider.prototype.queryIndex = function(query, callback) {
	'use strict';

	this.db.readTransaction(function(tx) {
		tx.executeSql(
			query.WebSQL.query, query.params,
			function(tx, results) {
				let len = results.rows.length;
				if (len > 0)
					callback(results.rows.item(0));
				else
					callback(null);
			},
			function() {
				callback(null);
			},
			function() {
				callback(null);
			},
			null);
	});

};

WebSQlProvider.prototype.queryIndexCount = function(query, callback) {
	this.queryIndex(query, function(result) {
		if (result != null) {
			callback(Object.values(result)[0]);
			return;
		}

		callback(result);
	});
};

/**
 *
 */
WebSQlProvider.prototype.executeDelete = function(query) {
	'use strict';

	this.db.transaction(function(tx) {
		tx.executeSql(
			query.WebSQL.query, query.WebSQL.params,
			function() {
			},
			sql_error);
	});
};

/**
 *
 */
WebSQlProvider.prototype.put = function(query) {
	'use strict';

	this.db.transaction(function(tx) {
		tx.executeSql(
			query.WebSQL.query, query.WebSQL.data,
			null, sql_error);
	}, sql_error, null);
};

/**
 *
 */
WebSQlProvider.prototype.open = function(options) {
	'use strict';

	this.db = window.openDatabase(
		'TSDB',
		'3.0',
		'TabSuspender database',
		300 * 1024 * 1024,
		function(db) {
			console.log('WebSql opened.');
			if (options == null || options.skipSchemaCreation == false) {
				db.transaction(function(tx) {
					tx.executeSql('CREATE TABLE IF NOT EXISTS ' +
						'screens (id INTEGER, sessionId INTEGER, added_on DATETIME, screen TEXT, PRIMARY KEY(id, sessionId))', null, null, sql_error);
					console.log('WebSql tables created.');
				}, sql_error, null);
			}
		}
	);
};
