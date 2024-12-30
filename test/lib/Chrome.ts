import SyncStorageArea = chrome.storage.SyncStorageArea;
import { mock } from 'ts-jest-mocker';
import StorageArea = chrome.storage.StorageArea;

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
