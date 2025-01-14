// eslint-disable-next-line @typescript-eslint/no-unused-vars
class LocalStore {
	// TODO-v4: Why LocalStore used? have Store class with all features and checks - replace calls with Store class
	static async get(key: string): Promise<any> {
		return (await chrome.storage.local.get([key]))[key];
	}

	static set(key: string, value: any): Promise<void> {
		return chrome.storage.local.set({[key]: value});
	}

	static remove(key: string): Promise<void> {
		return chrome.storage.local.remove(key);
	}
}