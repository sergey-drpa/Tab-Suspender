enum LocalStoreKeys {
	INSTALLED = 'installed',
	PARK_HISTORY = 'parkHistory',
	CLOSE_HISTORY = 'closeHistory'
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class LocalStore {

	private static keys = Object.fromEntries(Object.values(LocalStoreKeys).map(name => [name, true]));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	static async get(key: string): Promise<any> {
		this.checkKey(key);
		return (await chrome.storage.local.get([key]))[key];
	}

	static set(key: string, value: unknown): Promise<void> {
		this.checkKey(key);
		return chrome.storage.local.set({ [key]: value });
	}

	static remove(key: string): Promise<void> {
		this.checkKey(key);
		return chrome.storage.local.remove(key);
	}

	private static checkKey(key: string) {
		if (!LocalStore.keys[key]) {
			console.error(`Key[${key}] is not supported by LocalStore`);
		}
	}
}
