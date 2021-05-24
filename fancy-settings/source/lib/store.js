//
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/frankkohlhepp/store-js
// License: MIT-license
//

(function () {
    var Store = this.Store = function (name, defaults, isNotMainSettings) {
        var key;
        this.name = name;
        this.onStorageInitialized = undefined;
        this.onStorageInitialized = new Promise(resolve => {

            if(!isNotMainSettings) {

                // Retrieve data from Sync
                chrome.storage.sync.get(null, (items) => {
                    // Pass any observed errors down the promise chain.
                    /* TODO: Implement sync from sync server
                    if (!chrome.runtime.lastError) {
                        console.log('Retrieve Sync changes and cache locally....');
                        if (items !== undefined) {
                            for (key in items) {
                                if (items.hasOwnProperty(key)) {
                                    const localValue = this.get(key);
                                    const syncValue = checkTypeAndCast(key, JSON.parse(items[key]));
                                    if (localValue !== syncValue) {
                                        console.log(`Initial Retrieve Sync changes: ${key}: '${localValue}' -> ${syncValue}`);
                                        try {
                                            this.set(key, syncValue, true);
                                        } catch (e) {
                                            console.warn(e);
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        console.error(chrome.runtime.lastError);
                    }*/


                    if (defaults !== undefined) {
                        for (key in defaults) {
                            if (defaults.hasOwnProperty(key)) {
                                if (this.get(key) === undefined) {
                                    this.set(key, defaults[key], true);
                                }
                                /* NO NEED DEFAULTS IN SYNC
                                ((localKey) => {
                                    this.getSync(localKey).then((valueFromSync) => {
                                        const syncValue = checkTypeAndCast(localKey, JSON.parse(valueFromSync));
                                        if (syncValue === undefined && syncValue !== this.get(localKey)) {
                                            console.log(`Initial Setup Sync values: ${localKey}: '${valueFromSync}' -> ${defaults[localKey]}`);
                                            this.set(localKey, defaults[localKey]);
                                        }
                                    });
                                })(key);*/
                            }
                        }
                    }


                    chrome.storage.onChanged.addListener(function(changes, namespace) {
                        if (namespace === 'sync') {
                            for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
                                // TODO: Implement sync from sync server
                                console.log(
                                  `Storage key "${key}" in namespace "${namespace}" changed.`,
                                  `Old value was "${oldValue}", new value is "${newValue}".`
                                );
                            }
                        }
                    });

                    resolve();
                });
            }
        });
    };

    Store.prototype.getOnStorageInitialized = function () { return this.onStorageInitialized; }

    Store.prototype.getSync = function (name) {
        return new Promise(resolve => {
            chrome.storage.sync.get([name], function(result) {
                console.log(`[GET] Sync Value currently is [${name}]: ` + result[name]);
                try {
                    resolve(JSON.parse(result[name]), name);
                } catch (e) {
                    resolve(null, name);
                }
            });
        });
    };

    function checkTypeAndCast (name, value) {
        if(window.SETTINGS_TYPES == null) {
            console.error(`window.SETTINGS_TYPES not defined!!!`);
            try {
                return JSON.parse(value);
            } catch (e) {
                return value;
            }
        }
        if(value == null) {
            return value;
        }

        switch (window.SETTINGS_TYPES[name]) {
            case window.NUMBER_TYPE:
                if (typeof value !== "number") {
                    try {
                        return parseFloat(value);
                    } catch (e) {
                        return value;
                    }
                }
                break;
            case window.STRING_TYPE:
                if(value.startsWith("\"")) {
                    try {
                        return JSON.parse(value);
                    } catch (e) {
                        return value;
                    }
                }
                break;
            default: //Boolean
                if (typeof value !== "boolean") {
                    try {
                        return JSON.parse(value);
                    } catch (e) {
                        return value;
                    }
                }
                break;
        }
        return value;
    }

    Store.get = Store.prototype.get = function (name, namespace) {
        const initialName = name;
        name = "store." + (namespace ? namespace : this.name) + "." + name;
        const value = localStorage.getItem(name);
        if (value === null) { return undefined; }
        try {
            return checkTypeAndCast(initialName, JSON.parse(value));
        } catch (e) {
            console.error(e)
            return value;
        }
    };

    Store.prototype.set = function (name, value, skipSync) {

        if(debug) {
            console.log(`[SET]: Local previous value for [${name}] was: ${this.get(name)}`);
        }

        if (value === undefined) {
            this.remove(name);
        } else {
            if (typeof value === "function") {
                value = null;
            } else {
                try {
                    value = JSON.stringify(value);
                } catch (e) {
                    value = null;
                }
            }

            localStorage.setItem("store." + this.name + "." + name, value);

            if(!skipSync) {
                this.setSync(name, value);
            }
        }

        return this;
    };

    Store.prototype.setSync = async function (name, value) {
        return new Promise( (resolve) => {
            if(debug) {
                this.getSync(name).then(currentValue => {
                    console.log(`[SET]: Sync previous value for [${name}] was: ${currentValue}`);
                });
            }
            const object = {};
            object[name] = value;
            chrome.storage.sync.set(object, function() {
                console.log(`[SET]: Sync Value for [${name}] is set to: ${value}`);
                resolve(name, value);
            });
        });
    };

    Store.prototype.remove = function (name) {
        this.removeSync(name);
        localStorage.removeItem("store." + this.name + "." + name);
        return this;
    };

    Store.prototype.removeSync = function (name) {
        return new Promise(resolve => {
            chrome.storage.sync.remove([name], function() {
                console.log('Sync Value removed: ' + name);
                resolve(name);
            });
        });
    };

    Store.prototype.removeAll = function () {
        var name, i;

        this.removeAllSync();

        name = "store." + this.name + ".";
        for (i = (localStorage.length - 1); i >= 0; i--) {
            if (localStorage.key(i).substring(0, name.length) === name) {
                localStorage.removeItem(localStorage.key(i));
            }
        }

        return this;
    };

    Store.prototype.removeAllSync = function () {
        return new Promise(resolve => {
            chrome.storage.sync.clear(function() {
                console.log('Sync Value removedAll: ');
                resolve();
            });
        });
    };

    Store.prototype.toObject = function () {
        var values,
            name,
            i,
            key,
            value;

        values = {};
        name = "store." + this.name + ".";
        for (i = (localStorage.length - 1); i >= 0; i--) {
            if (localStorage.key(i).substring(0, name.length) === name) {
                key = localStorage.key(i).substring(name.length);
                value = this.get(key);
                if (value !== undefined) { values[key] = value; }
            }
        }

        return values;
    };

    Store.prototype.fromObject = function (values, merge) {
        if (merge !== true) { this.removeAll(); }
        for (var key in values) {
            if (values.hasOwnProperty(key)) {
                this.set(key, values[key]);
            }
        }

        return this;
    };
}());
