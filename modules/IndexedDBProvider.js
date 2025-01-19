/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

'use strict';

const SCREENS_DB_NAME = 'screens';
const FD_DB_NAME = 'fd';
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
	void this.getTransaction([query.IDB.table], 'readonly')
		.then(function(transaction) {
			let objectStore = transaction.objectStore(query.IDB.table);

			let resultsRowsArray = [];

			if (query.IDB.predicate != null) {
				if (query.IDB.predicate === 'getAllKeys') {
					let cursor = objectStore.index(query.IDB.index).openKeyCursor();

					cursor.onsuccess = function(e) {
						if (!e.target.result) {
							if (query.IDB.predicateResultLogic != null)
								return callback(query.IDB.predicateResultLogic(resultsRowsArray));
							else
								return callback(resultsRowsArray);
						}

						let res = e.target.result;
						resultsRowsArray.push(res.key);
						res['continue']();
					};

					cursor.onerror = function(e) {
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

			let storeWithIndex = store;
			if(query.IDB.index)
				storeWithIndex = store.index(query.IDB.index);

			const request = storeWithIndex.get(IDBKeyRange.only(query.params));

			request.onsuccess = function(e) {
				const result = e.target.result;

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
			const store = transaction.objectStore(query.IDB.table);

			let storeWithIndex = store;
			if(query.IDB.index)
				storeWithIndex = store.index(query.IDB.index);

			const request = storeWithIndex.get(IDBKeyRange.only(query.IDB.params));

			request.onsuccess = function(e) {
				const result = e.target.result;

				if (result != null) {
						let combinedKeyValues = null;
						if(typeof store.keyPath === 'string')
							combinedKeyValues = result[store.keyPath];
						else
							combinedKeyValues = store.keyPath.map(key => result[key]);
						store['delete'](combinedKeyValues);
					}
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
	// eslint-disable-next-line @typescript-eslint/no-this-alias
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
			}).catch(console.error);
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
	// eslint-disable-next-line @typescript-eslint/no-this-alias
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
			// eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
		} catch (e) { }
	}
}

/**
 *
 */
IndexedDBProvider.prototype.open = function(options) {
	// eslint-disable-next-line @typescript-eslint/no-this-alias
	let self = this;

	this.close();

	let openRequest = indexedDB.open('TSDB', 6);

	openRequest.onupgradeneeded = function(upgradeEvent) {
		let thisDB = upgradeEvent.target.result;
		const tx = upgradeEvent.target.transaction;

		console.log(`IDBVersionChangeEvent: `, upgradeEvent);


		if (options == null || options.skipSchemaCreation == false) {

			/* If initial setup... */
			if (upgradeEvent.oldVersion === 0) {

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
			}

			/* Upgrade to new version... after add next migration move old migration code to "initial setup" section */
			if (upgradeEvent.newVersion === 6) {
				thisDB.createObjectStore(FD_DB_NAME, { keyPath: ['tabId'] });
			}

			/*if (!thisDB.objectStoreNames.contains(SCREENS_BINARY_DB_NAME)) {
				thisDB.createObjectStore(SCREENS_BINARY_DB_NAME);
			}*/
		}
	};


	this.initializedPromise = new Promise(function(resolve, reject) {
		openRequest.onsuccess = function(e) {
			console.log('IDB Connected successfully');
			self.db = e.target.result;
			self.initialized = true;
			self.db.onversionchange = () => {
				self.db.close();
				console.log("A new version of this page is ready. Please reload or close this tab!");
			};
			resolve();
		};

		openRequest.onerror = function(e) {
			console.error('IDB error:', e);
			reject(e);
		};
	});
};



if (typeof module != "undefined")
	module.exports = {
		ADDED_ON_INDEX_NAME,
	}