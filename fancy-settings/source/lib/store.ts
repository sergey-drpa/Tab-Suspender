//
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/frankkohlhepp/store-js
// License: MIT-license
//

const SETTINGS_STORAGE_NAMESPACE = 'tabSuspenderSettings'; /* Also has duplicats in fancy-settings/../settings.js */

trackErrors('settings_page', true);



// eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
// @ts-ignore
class SettingsStoreClient {
    private readonly namespace: string = SETTINGS_STORAGE_NAMESPACE;

    constructor(namespace?: string){
        if(namespace != null)
            this.namespace = namespace;
    }

    getSync(name: string) {
        return new Promise(resolve => {
            chrome.storage.sync.get([name], function(result) {
                console.log(`[GET] Sync Value currently is [${name}]: ` + result[name]);
                try {
                    resolve(JSON.parse(result[name]));
                } catch {
                    resolve(null);
                }
            });
        });
    }

    private static genName(name: string, namespace: string) {
        return 'store.' + (namespace ? namespace : SETTINGS_STORAGE_NAMESPACE) + '.' + name;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async get(name: string, namespace: string): Promise<any> {

        if (DEFAULT_SETTINGS[name] === undefined) {
            throw new Error(`SettingsStore.get(): Unknown property '${name}'`);
        }

        name = this.genName(name, namespace);

        return (await chrome.storage.local.get([name]))[name];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async get(name: string): Promise<any> {
        return SettingsStoreClient.get(name, this.namespace);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async getAll(namespace: string): Promise<object> {

        const keys = Object.keys(DEFAULT_SETTINGS)
          .map(key=> this.genName(key, namespace))


        return (await chrome.storage.local.get(keys));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getAll(): Promise<any> {
        return SettingsStoreClient.getAll(this.namespace);
    }

    async set(name: string, value: unknown, skipSync?) {

        if (DEFAULT_SETTINGS[name] === undefined) {
            throw new Error(`SettingsStore.get(): Unknown property '${name}'`);
        }

        if(debug) {
            console.log(`[SET]: Local previous value for [${name}] was: ${await this.get(name)}, new: ${value}`);
        }

        if (value === undefined) {
            this.remove(name);
        } else {
            /*if (typeof value === "function") {
                value = null;
            } else {
                try {
                    value = JSON.stringify(value);
                } catch (e) {
                    value = null;
                }
            }*/

            chrome.storage.local.set({
                [SettingsStoreClient.genName(name, this.namespace)]: value
            }).catch(console.error);

            if(!skipSync) {
                this.setSync(name, value).catch(console.error);
            }
        }

        return this;
    }

    async setSync(name: string, value: unknown) {
        return new Promise( (resolve, reject) => {
            if(debug) {
                this.getSync(name).then(currentValue => {
                    console.log(`[SET]: Sync previous value for [${name}] was:`, currentValue);
                }).catch((e) => { console.error(e); });
            }
            const object = {};
            object[name] = value;
            chrome.storage.sync.set(object).then(()=>{
                console.log(`[SET]: Sync Value for [${name}] is set to: ${value}`);
                resolve(name);
            }).catch((e) => { console.error(`Error when sync.set(...)`, e, object); reject(e); });
        });
    }

    remove(name: string, skipSync?) {
        chrome.storage.local.remove(SettingsStoreClient.genName(name, this.namespace)).catch(console.error);

        if (!skipSync) {
            void this.removeSync(name);
        }
        return this;
    }

    removeSync(name: string): Promise<void> {
        return chrome.storage.sync.remove([name]).then(function() {
            console.log('Sync Value removed: ' + name);
        }).catch(console.error);
    }
}


// eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
// @ts-ignore
class SettingsStore extends SettingsStoreClient {
    private readonly offscreenDocumentProvider: OffscreenDocumentProvider;
    private readonly onStorageInitialized: Promise<void>;

    constructor(namespace: string | null, default_settings: Settings, offscreenDocumentProvider?: OffscreenDocumentProvider) {

        super(namespace);

        this.offscreenDocumentProvider = offscreenDocumentProvider;
        this.onStorageInitialized = new Promise(resolve => {

            // Retrieve data from Sync
            chrome.storage.sync.get(null as string).then(async (items) => {
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


                if (default_settings !== undefined) {

                    await this.initOrMigrateSettings(offscreenDocumentProvider, default_settings);

                    void this.cleanLocalStorageFormData();

                    this.calculateDisplayBasedDefaultSettings();
                } else {
                    console.error(`Default Settings is null!`);
                }


                chrome.storage.onChanged.addListener(function(changes, namespace) {
                    if (namespace === 'sync') {
                        for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
                            // TODO: Implement sync from sync server
                            console.log(
                              `Storage key "${key}" in namespace "${namespace}" changed.`,
                              `Old value was "${oldValue}", new value is "${newValue}".`
                            );
                        }
                    }
                });

                resolve();
            }).catch(console.error);

        });
    }

    private async initOrMigrateSettings(offscreenDocumentProvider: OffscreenDocumentProvider, default_settings: Settings) {

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        // Migration from old V2 Manifest settings...
        if (!await this.get('localStorageMigrated')) {
            const oldSettings = await offscreenDocumentProvider.extractOldSettings(Object.keys(default_settings));

            if (oldSettings['active'] != undefined) {
                console.log(`Need to migrate Old Settings...`);

                console.log(`Old Settings: `, oldSettings);

                for (const key in oldSettings) {
                    if (oldSettings.hasOwnProperty(key)) {
                        const currentValue = await this.get(key);
                        if (currentValue == undefined) {
                            let value = self.checkTypeAndCast(key, oldSettings[key]);
                            if (value == null ||
                              typeof value != GET_SETTINGS_TYPE(key)
                            )
                                await this.set(key, default_settings[key], true);
                            else
                                await this.set(key, value, true);
                        }
                    }
                }

                await this.set('localStorageMigrated', true);
                await LocalStore.set(LocalStoreKeys.INSTALLED, true);
            }
        }

        // Store DEFAULT_SETTINGS
        for (const key in default_settings) {
            if (default_settings.hasOwnProperty(key)) {
                let storedValue = await this.get(key);
                if (storedValue == undefined ||
                  typeof storedValue != GET_SETTINGS_TYPE(key)
                ) {
                    await this.set(key, default_settings[key], true);
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

    private calculateDisplayBasedDefaultSettings() {
        // TODO-v4: compute limits for each display and map it with opened windows
        /*if (chrome.system?.display)
            try {
                chrome.system.display.getInfo(function(displayInfo) {
                    try {
                        if (displayInfo != null) {
                            const displayWidth = displayInfo[0].workArea.width;

                            if (displayWidth != null && displayWidth > 0)
                                DEFAULT_SETTINGS.limitOfOpenedTabs = displayWidth / 90.29;
                        }
                    } catch (e) {
                        console.error(e);
                    }

                    void prepare();
                });
            } catch (e) {
                console.error(e);
                void prepare();
            }
        else
            void prepare();*/
    }

    private async cleanLocalStorageFormData() {
        if (!await this.get('localStorageFormDataCleaned')) {
            await this.offscreenDocumentProvider.cleanupFormDatas();
            await this.set('localStorageFormDataCleaned', true);
        }
    }

    getOnStorageInitialized() {
        return this.onStorageInitialized;
    }

    checkTypeAndCast(name, value) {
        if(SETTINGS_TYPES == null) {
            console.error(`window.SETTINGS_TYPES not defined!!!`);
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }
        if(value == null) {
            return value;
        }

        switch (SETTINGS_TYPES[name]) {
            case NUMBER_TYPE:
                if (typeof value !== "number") {
                    try {
                        return parseFloat(value);
                    } catch {
                        return value;
                    }
                }
                break;
            case STRING_TYPE:
                if(value.startsWith("\"")) {
                    try {
                        return JSON.parse(value);
                    } catch {
                        return value;
                    }
                }
                break;
            default: //Boolean
                if (typeof value !== "boolean") {
                    try {
                        return JSON.parse(value);
                    } catch {
                        return value;
                    }
                }
                break;
        }
        return value;
    }

    async removeAll() {
        await this.removeAllSync();

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        await Promise.all(Object.keys(DEFAULT_SETTINGS)
          .map(async (key) => {
              self.remove(key);
          }));

        return this;
    }

    removeAllSync(): Promise<void> {
        return chrome.storage.sync.clear().then(function() {
            console.log('Sync Value removedAll: ');
        }).catch(console.error);
    }

    async toObject() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        let value: unknown;
        const values = {};

        await Promise.all(Object.keys(DEFAULT_SETTINGS)
          .map(async (key) => {
              value = await self.get(key);
              if (value !== undefined) {
                  values[key] = value;
              }
          }));

        return values;
    }

    /*fromObject(values, merge) {
        if (merge !== true) { this.removeAll(); }
        for (var key in values) {
            if (values.hasOwnProperty(key)) {
                this.set(key, values[key]);
            }
        }

        return this;
    }*/
}

if (typeof global !== "undefined") {
    // @ts-ignore
    global.SettingsStore = SettingsStore;
    // @ts-ignore
    global.SettingsStoreClient = SettingsStoreClient;
}







