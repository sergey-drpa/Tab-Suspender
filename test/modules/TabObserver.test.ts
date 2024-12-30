//import { greet } from './greet';
//import { TabObserver } from '../../modules/TabObserver';
//import { DEFAULT_SETTINGS, SETTINGS_TYPES } from '../../modules/Settings';
//require('../../modules/Settings');


//import { SettingsStore } from '../lib/Chrome';


//jest.spyOn(config, 'foo', 'get').mockReturnValue('zed');

describe('greet function', () => {
	it('should return a greeting with the given name', async () => {
		//const result = greet('John');
		//expect(result).toEqual('Hello, John!');
		const settings = new SettingsStore('test', DEFAULT_SETTINGS);
		// @ts-ignore
		global.settings = settings;


		await settings.getOnStorageInitialized();

		const tabObserver = new TabObserver(null);


		await new Promise(r => setTimeout(r, 20000));
	});
});