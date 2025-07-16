import SyncStorageArea = chrome.storage.SyncStorageArea;
//import { mock } from 'ts-jest-mocker';
import StorageArea = chrome.storage.StorageArea;

global.structuredClone = val => {
	return JSON.parse(JSON.stringify(val))
}

const memoryStorage = {};

const chrome_ = {
	storage: {
		sync: <chrome.storage.StorageArea>{

			async get(keys?: string | string[] | { [key: string]: any } | null): Promise<{ [key: string]: any }> {
				return null;
			}
		},

		local: <chrome.storage.LocalStorageArea>{

			async get(keys?: /*string | */string[] | { [key: string]: any } | null): Promise<{ [key: string]: any }> {
				const result = {};
				keys.forEach(key => {result[key] = memoryStorage[key]});
				return result;
			},

			async set(items: { [p: string]: any }): Promise<void> {
				for (const key in items) {
					if (items.hasOwnProperty(key)) {
						memoryStorage[key] = items[key];
					}
				}
			}
		},

		onChanged: {
			addListener(callback: any): void {
				console.warn(`Unimplemented: chrome.storage.onChanged.addListener()`)
			}
		}
	},
	runtime: {
		getURL: (filePath) => `chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/${filePath}`,
	}
};

// @ts-ignore
global.chrome = chrome_;
// @ts-ignore
global.debug = true;
// @ts-ignore
global.pauseTics = 0;
// @ts-ignore
global.batteryLevel = 0;
// @ts-ignore
global.parkUrl = 'chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/park.html?title=js%20copy%20object%20-%20%D0%9F%D0%BE%D0%B8%D1%81%D0%BA%20%D0%B2%20Google&url=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Djs%2Bcopy%2Bobject%26oq%3Djs%2Bcopy%2Bobject%26gs_lcrp%3DEgZjaHJvbWUyCQgAEEUYORiABDIHCAEQABiABDIHCAIQABiABDIHCAMQABiABDIHCAQQABiABDIHCAUQABiABDIHCAYQABiABDIHCAcQABiABDIHCAgQABiABDIHCAkQABiABNIBCDQ3MjlqMGo3qAIAsAIA%26sourceid%3Dchrome%26ie%3DUTF-8&tabId=323495450&sessionId=1737672003275&icon=undefined';
// @ts-ignore
global.getScreenCache = null;
// @ts-ignore
global.previousTSSessionId = 121232134213;
// @ts-ignore
global.TSSessionId = 121232134214;
// @ts-ignore
global.trace = true;

function addModuleToGlobal(module) {
	Object.keys(module).forEach(key => {
		global[key] = module[key];
	});
}

global.addModuleToGlobal = addModuleToGlobal;

addModuleToGlobal(require('../../utils'));
addModuleToGlobal(require('../../modules/errorsProcessing'));
addModuleToGlobal(require('../../modules/DBProvider'));
addModuleToGlobal(require('../../modules/IndexedDBProvider'));
addModuleToGlobal(require('../../modules/DbUtils'));
addModuleToGlobal(require('../../modules/ScreenshotController'));