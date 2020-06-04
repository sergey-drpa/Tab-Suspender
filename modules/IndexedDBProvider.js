/*
 * Copyright (c) 2017 Sergey Zadorozhniy. The content presented herein may not, under any circumstances,
 * be reproduced in whole or in any part or form without written permission from Sergey Zadorozhniy.
 * Zadorozhniy.Sergey@gmail.com
 */

"use strict";

const SCREENS_DB_NAME = 'screens';
const ADDED_ON_INDEX_NAME = 'addedOnIndex';

/**
 *
 */
function IndexedDBProvider (options)
{
    this.db = null;
    this.initialized = false;
    this.initializedPromise = null;

    this.open(options);
}

/**
 *
 */
IndexedDBProvider.prototype.getAll = function(query, callback, errorCallback)
{
    //var transaction = this.db.transaction([query.IDB.table], "readonly");
    this.getTransaction([query.IDB.table], "readonly")
        .then(function(transaction) {
            var objectStore = transaction.objectStore(query.IDB.table);

            var resultsRowsArray = [];

            if (query.IDB.predicate != null) {
                if (query.IDB.predicate == "getAllKeys") {
                    var getAllKeysRequest = objectStore.index(query.IDB.index).getAllKeys();

                    getAllKeysRequest.onsuccess = function () {
                        //console.log(getAllKeysRequest.result);
                        if (query.IDB.predicateResultLogic != null)
                            callback(query.IDB.predicateResultLogic(getAllKeysRequest.result));
                        else
                            callback(getAllKeysRequest.result);
                    }

                    getAllKeysRequest.onerror = function (e) {
                        console.error("Error", e.target.error);
                        //callback(null);
                        (errorCallback != null ? errorCallback : sql_error)(e);
                    }
                }
                else
                    throw new Error('UUnimplemented predicate name: ' + query.IDB.predicate);
            }
            else {
                var cursor = objectStore.openCursor();

                cursor.onsuccess = function (e) {
                    if (!e.target.result)
                        return callback(resultsRowsArray)

                    var res = e.target.result;
                    resultsRowsArray.push(res.value);
                    res['continue']();
                }

                cursor.onerror = function (e) {
                    console.error("Error", e.target.error);
                    //callback(null);
                    (errorCallback != null ? errorCallback : sql_error)(e);
                }
            }
        });
}

/**
 *
 */
IndexedDBProvider.prototype.queryIndex = function(query, callback)
{
    //var transaction = this.db.transaction([query.IDB.table],"readonly");
    this.getTransaction([query.IDB.table],"readonly")
        .then(function(transaction) {
            var store = transaction.objectStore(query.IDB.table);

            //console.log(query);
            var request = store.index(query.IDB.index).get(IDBKeyRange.only(query.params));

            request.onsuccess = function (e) {
                var result = e.target.result;

                callback(result);
            }

            request.onerror = function (e) {
                console.error("Error", e.target.error);
                callback(null);
            }
        });
}

/**
 *
 */
IndexedDBProvider.prototype.queryIndexCount = function(query, callback)
{
    //this.db.transaction([query.IDB.table],"readonly");
    this.getTransaction([query.IDB.table],"readonly")
        .then(function(transaction){
            var store = transaction.objectStore(query.IDB.table);

            //console.log(query);
            var request = store.index(query.IDB.index).count(IDBKeyRange.only(query.params));

            request.onsuccess = function(e)
            {
                callback(request.result);
            }

            request.onerror = function(e)
            {
                console.error("Error",e.target.error);
                callback(0);
            }
        });
}

/**
 *
 */
IndexedDBProvider.prototype.executeDelete = function(query/*, callback*/)
{
    //var transaction = this.db.transaction([query.IDB.table], "readwrite");
    this.getTransaction([query.IDB.table], "readwrite")
        .then(function(transaction) {
            var store = transaction.objectStore(query.IDB.table);

            var request = store.index(query.IDB.index).get(IDBKeyRange.only(query.IDB.params));

            request.onsuccess = function (e) {
                var result = e.target.result;

                if(result != null)
                    store['delete']([result.id, result.sessionId]);
                else
                    console.error("executeDelete error(e, e.target, e.target.result): ", e, e.target, e.target.result);
            }

            request.onerror = function (e) {
                console.error("Error", e.target.error);
                //callback(null);
            }
        });
}

/**
 *
 */
IndexedDBProvider.prototype.put = function(query)
{
    //var transaction = this.db.transaction([query.IDB.table],"readwrite");
    this.getTransaction([query.IDB.table],"readwrite")
        .then(function(transaction) {
            var store = transaction.objectStore(query.IDB.table);

            var request = store.put(query.IDB.data);

            request.onerror = function (e) {
                console.error("Error", e.target.error);
            };

            request.onsuccess = function (e) {
                //console.log("Woot! Did it");
            };
        });
};

/**
 *
 */
IndexedDBProvider.prototype.getTransaction = function(tables, mode)
{
    var self = this;
    try
    {
        if(this.db == null)
            return new Promise(function(resolve, reject) {
                self.initializedPromise.then(function () {
                    resolve(self.db.transaction(tables, mode));
                });
            });

        return new Promise(function(resolve, reject) {
            resolve(self.db.transaction(tables, mode));
        });
    }
    catch(e)
    {
        console.error(e);
        if(e.name === 'InvalidStateError')
        {
            return new Promise(function(resolve, reject) {
                self.open();
                self.initializedPromise.
                then(function(){resolve(self.db.transaction(tables, mode));},
                    function(e){
                    e.message = 'Could not reconnect to IndexedDB!!!!!: ' + e.message;
                    throw e;
                });
            });
        }
        else
        {
            e.message = 'Unexpected getTransaction Exception: ' + e.message;
            throw e;
        }
    }
}

/**
 *
 */
IndexedDBProvider.prototype.open = function(options)
{
    "use strict";

    var openRequest = window.indexedDB.open("TSDB",5);

    openRequest.onupgradeneeded = function(e)
    {
        var thisDB = e.target.result;
        const tx = e.target.transaction;

        if(options == null || options.skipSchemaCreation == false)
        {
            if (!thisDB.objectStoreNames.contains(SCREENS_DB_NAME))
            {
                var objectStore = thisDB.createObjectStore(SCREENS_DB_NAME, {keyPath: ['id', 'sessionId']});
                objectStore.createIndex("PK", ['id', 'sessionId'], {unique: true});
            }

            const screens = tx.objectStore(SCREENS_DB_NAME);
            if(!screens.indexNames.contains(ADDED_ON_INDEX_NAME)) {
              console.log(`Start ${ADDED_ON_INDEX_NAME} index creation`);
              screens.createIndex(ADDED_ON_INDEX_NAME, ['id', 'sessionId', 'added_on'], {unique: true});
              console.log(`Completed ${ADDED_ON_INDEX_NAME} index creation`);
            }
        }
    };


    var self = this;
    this.initializedPromise = new Promise(function(resolve, reject) {
        openRequest.onsuccess = function(e)
        {
            console.log("running onsuccess");
            self.db = e.target.result;
            self.initialized = true;
            resolve();
        };

        openRequest.onerror = function(e)
        {
            console.error("IDB error:", e);
            reject(e);
        };
    });
};
