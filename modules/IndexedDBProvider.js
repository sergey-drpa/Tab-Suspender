/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

'use strict';

const SCREENS_DB_NAME = 'screens';
// eslint-disable-next-line no-redeclare
const ADDED_ON_INDEX_NAME = 'addedOnIndex';

/**
 *
 */
function IndexedDBProvider(options) {
	this.db = null;
	this.initialized = false;
	this.initializedPromise = null;

	this.open(options);
}

/**
 *
 */
IndexedDBProvider.prototype.getAll = function(query, callback, errorCallback) {
	this.getTransaction([query.IDB.table], 'readonly')
		.then(function(transaction) {
			let objectStore = transaction.objectStore(query.IDB.table);

			let resultsRowsArray = [];

			if (query.IDB.predicate != null) {
				if (query.IDB.predicate == 'getAllKeys') {
					let getAllKeysRequest = objectStore.index(query.IDB.index).getAllKeys();

					getAllKeysRequest.onsuccess = function() {
						if (query.IDB.predicateResultLogic != null)
							callback(query.IDB.predicateResultLogic(getAllKeysRequest.result));
						else
							callback(getAllKeysRequest.result);
					};

					getAllKeysRequest.onerror = function(e) {
						console.error('Error', e.target.error);
						(errorCallback != null ? errorCallback : sql_error)(e);
					};
				} else
					throw new Error('UUnimplemented predicate name: ' + query.IDB.predicate);
			} else {
				let cursor = objectStore.openCursor();

				cursor.onsuccess = function(e) {
					if (!e.target.result)
						return callback(resultsRowsArray);

					let res = e.target.result;
					resultsRowsArray.push(res.value);
					res['continue']();
				};

				cursor.onerror = function(e) {
					console.error('Error', e.target.error);
					(errorCallback != null ? errorCallback : sql_error)(e);
				};
			}
		});
};

/**
 *
 */
IndexedDBProvider.prototype.queryIndex = function(query, callback) {
	this.getTransaction([query.IDB.table], 'readonly')
		.then(function(transaction) {
			let store = transaction.objectStore(query.IDB.table);

			let request = store.index(query.IDB.index).get(IDBKeyRange.only(query.params));

			request.onsuccess = function(e) {
				let result = e.target.result;

				callback(result);
			};

			request.onerror = function(e) {
				console.error('Error', e.target.error);
				callback(null);
			};
		});
};

/**
 *
 */
IndexedDBProvider.prototype.queryIndexCount = function(query, callback) {
	this.getTransaction([query.IDB.table], 'readonly')
		.then(function(transaction) {
			let store = transaction.objectStore(query.IDB.table);

			let request = store.index(query.IDB.index).count(IDBKeyRange.only(query.params));

			request.onsuccess = function() {
				callback(request.result);
			};

			request.onerror = function(e) {
				console.error('Error', e.target.error);
				callback(0);
			};
		});
};

/**
 *
 */
IndexedDBProvider.prototype.executeDelete = function(query/*, callback*/) {
	this.getTransaction([query.IDB.table], 'readwrite')
		.then(function(transaction) {
			let store = transaction.objectStore(query.IDB.table);

			let request = store.index(query.IDB.index).get(IDBKeyRange.only(query.IDB.params));

			request.onsuccess = function(e) {
				let result = e.target.result;

				if (result != null)
					store['delete']([result.id, result.sessionId]);
				else
					console.error('executeDelete error(e, e.target, e.target.result): ', e, e.target, e.target.result);
			};

			request.onerror = function(e) {
				console.error('Error', e.target.error);
			};
		});
};

/**
 *
 */
IndexedDBProvider.prototype.put = function(query) {
	this.getTransaction([query.IDB.table], 'readwrite')
		.then(function(transaction) {
			let store = transaction.objectStore(query.IDB.table);

			let request = store.put(query.IDB.data);

			request.onerror = function(e) {
				console.error('Error', e.target.error);
			};

			request.onsuccess = function() {
			};
		});
};

/**
 *
 */
IndexedDBProvider.prototype.putV2 = function(queries) {
	this.getTransaction(queries.map(query=>query.IDB.table), 'readwrite')
		.then(function(transaction) {
			queries.forEach(query => {
				let store = transaction.objectStore(query.IDB.table);

				let request = store.put(query.IDB.data, query.IDB.key);

				request.onerror = function(e) {
					console.error('Error', e.target.error);
				};

				request.onsuccess = function() {
				};
			});
		});
};

/**
 *
 */
IndexedDBProvider.prototype.getTransaction = function(tables, mode) {
	let self = this;
	if (this.db == null)
		return new Promise(function(resolve, reject) {
			self.initializedPromise.then(function() {
				try {
					resolve(self.db.transaction(tables, mode));
				} catch (e) {
					console.error(e);
					self.getTransactionWithReconnect(e, tables, mode)
						.then(resolve)
						.catch(reject);
				}
			});
		});

	return new Promise(function(resolve, reject) {
		try {
			resolve(self.db.transaction(tables, mode));
		} catch (e) {
			console.error(e);
			self.getTransactionWithReconnect(e, tables, mode)
				.then(resolve)
				.catch(reject);
		}
	});
};

IndexedDBProvider.prototype.getTransactionWithReconnect = function(e, tables, mode) {
	let self = this;
	return new Promise(function(resolve, reject) {
		if (e.name === 'InvalidStateError') {

				self.open();
				self.initializedPromise.then(function() {
						try {
							resolve(self.db.transaction(tables, mode));
						} catch (e) {
							console.error(e);
							reject();
						}
					},
					function(e) {
						e.message = 'Could not reconnect to IndexedDB!!!!!: ' + e.message;
						reject();
						throw e;
					});
		} else {
			e.message = 'Unexpected getTransaction Exception: ' + e.message;
			reject();
			throw e;
		}
	});
}

/**
 *
 */
IndexedDBProvider.prototype.close = function() {
	if(this.db != null) {
		try {
			this.db.close();
			// eslint-disable-next-line no-empty
		} catch (e) { }
	}
}

/**
 *
 */
IndexedDBProvider.prototype.open = function(options) {
	let self = this;

	this.close();

	let openRequest = window.indexedDB.open('TSDB', 5);

	openRequest.onupgradeneeded = function(e) {
		let thisDB = e.target.result;
		const tx = e.target.transaction;

		if (options == null || options.skipSchemaCreation == false) {
			if (!thisDB.objectStoreNames.contains(SCREENS_DB_NAME)) {
				let objectStore = thisDB.createObjectStore(SCREENS_DB_NAME, { keyPath: ['id', 'sessionId'] });
				objectStore.createIndex('PK', ['id', 'sessionId'], { unique: true });
			}

			const screens = tx.objectStore(SCREENS_DB_NAME);
			if (!screens.indexNames.contains(ADDED_ON_INDEX_NAME)) {
				console.log(`Start ${ADDED_ON_INDEX_NAME} index creation`);
				screens.createIndex(ADDED_ON_INDEX_NAME, ['id', 'sessionId', 'added_on'], { unique: true });
				console.log(`Completed ${ADDED_ON_INDEX_NAME} index creation`);
			}

			/*if (!thisDB.objectStoreNames.contains(SCREENS_BINARY_DB_NAME)) {
				thisDB.createObjectStore(SCREENS_BINARY_DB_NAME);
			}*/
		}
	};


	this.initializedPromise = new Promise(function(resolve, reject) {
		openRequest.onsuccess = function(e) {
			console.log('running onsuccess');
			self.db = e.target.result;
			self.initialized = true;
			resolve();
		};

		openRequest.onerror = function(e) {
			console.error('IDB error:', e);
			reject(e);
		};
	});
};
