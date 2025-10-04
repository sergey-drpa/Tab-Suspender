// Import test setup first
import '../lib/Chrome';
import '../typing/global.d';

// Import the required modules
import '../../fancy-settings/source/lib/store';
import '../../modules/Settings';

// Set up required global variables
(global as any).debug = false;
(global as any).SETTINGS_TYPES = (global as any).SETTINGS_TYPES;
(global as any).GET_SETTINGS_TYPE = (global as any).GET_SETTINGS_TYPE;

describe('Settings Export/Import Functionality', () => {
    let mockStorageData: Record<string, any>;
    let settingsStore: any;

    // Mock the chrome storage to simulate actual browser behavior
    const mockChromeStorage = {
        local: {
            get: jest.fn().mockImplementation(async (keys: string[] | string) => {
                const result: Record<string, any> = {};
                if (Array.isArray(keys)) {
                    keys.forEach(key => {
                        if (mockStorageData[key] !== undefined) {
                            result[key] = mockStorageData[key];
                        }
                    });
                } else if (typeof keys === 'string') {
                    if (mockStorageData[keys] !== undefined) {
                        result[keys] = mockStorageData[keys];
                    }
                }
                return result;
            }),
            set: jest.fn().mockImplementation(async (data: Record<string, any>) => {
                Object.assign(mockStorageData, data);
            }),
            remove: jest.fn().mockImplementation(async (keys: string[] | string) => {
                if (Array.isArray(keys)) {
                    keys.forEach(key => delete mockStorageData[key]);
                } else {
                    delete mockStorageData[keys];
                }
            }),
            clear: jest.fn().mockImplementation(async () => {
                mockStorageData = {};
            })
        },
        sync: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined)
        }
    };

    beforeEach(() => {
        // Reset storage data before each test
        mockStorageData = {};

        // Update global chrome mock with our storage mock
        (global as any).chrome = {
            ...(global as any).chrome,
            storage: mockChromeStorage
        };

        // Mock offscreen document provider
        const mockOffscreenProvider = {
            extractOldSettings: jest.fn().mockResolvedValue({}),
            cleanupFormDatas: jest.fn().mockResolvedValue(undefined)
        };

        // Create a new SettingsStore instance for each test
        settingsStore = new (global as any).SettingsStore('tabSuspenderSettings', (global as any).DEFAULT_SETTINGS, mockOffscreenProvider);

        // Mock console methods to reduce noise during tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Export Functionality', () => {
        test('should export all default settings when no custom settings are set', async () => {
            const exported = await settingsStore.toObject();

            // Should contain all keys from DEFAULT_SETTINGS
            const defaultKeys = Object.keys((global as any).DEFAULT_SETTINGS);
            const exportedKeys = Object.keys(exported);

            expect(exportedKeys).toEqual(expect.arrayContaining(defaultKeys));

            // Should export default values
            expect(exported.active).toBe((global as any).DEFAULT_SETTINGS.active);
            expect(exported.timeout).toBe((global as any).DEFAULT_SETTINGS.timeout);
            expect(exported.parkBgColor).toBe((global as any).DEFAULT_SETTINGS.parkBgColor);
        });

        test('should export custom settings when they are set', async () => {
            // Set some custom values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 3600);
            await settingsStore.set('parkBgColor', 'FF0000');

            const exported = await settingsStore.toObject();

            // Should export the custom values, not defaults
            expect(exported.active).toBe(false);
            expect(exported.timeout).toBe(3600);
            expect(exported.parkBgColor).toBe('FF0000');

            // Should still export defaults for unmodified settings
            expect(exported.pinned).toBe((global as any).DEFAULT_SETTINGS.pinned);
        });

        test('should export all settings including complex types', async () => {
            // Set various types of settings
            await settingsStore.set('exceptionPatternsV2', '*.google.com*\n*.github.com*');
            await settingsStore.set('screenshotQuality', 95);
            await settingsStore.set('limitOfOpenedTabs', 30);

            const exported = await settingsStore.toObject();

            expect(exported.exceptionPatternsV2).toBe('*.google.com*\n*.github.com*');
            expect(exported.screenshotQuality).toBe(95);
            expect(exported.limitOfOpenedTabs).toBe(30);
        });
    });

    describe('Import Functionality', () => {
        test('should import settings and overwrite existing values', async () => {
            // First set some initial values
            await settingsStore.set('active', true);
            await settingsStore.set('timeout', 1800);

            // Import different values
            const importData = {
                active: false,
                timeout: 3600,
                parkBgColor: 'FF0000',
                screenshotQuality: 95
            };

            await settingsStore.fromObject(importData, false);

            // Verify imported values are set
            expect(await settingsStore.get('active')).toBe(false);
            expect(await settingsStore.get('timeout')).toBe(3600);
            expect(await settingsStore.get('parkBgColor')).toBe('FF0000');
            expect(await settingsStore.get('screenshotQuality')).toBe(95);
        });

        test('should preserve settings not included in import when merge=true', async () => {
            // Set initial values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 1800);
            await settingsStore.set('parkBgColor', 'BLUE123');

            // Import partial data with merge=true
            const importData = {
                active: true,
                timeout: 3600
                // Note: parkBgColor not included
            };

            await settingsStore.fromObject(importData, true);

            // Imported values should be updated
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);

            // Non-imported value should be preserved
            expect(await settingsStore.get('parkBgColor')).toBe('BLUE123');
        });

        test('should reset all settings when merge=false', async () => {
            // Set initial values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 1800);
            await settingsStore.set('parkBgColor', 'BLUE123');

            // Import partial data with merge=false (default)
            const importData = {
                active: true,
                timeout: 3600
                // Note: parkBgColor not included
            };

            await settingsStore.fromObject(importData, false);

            // Imported values should be set
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);

            // Non-imported value should revert to default
            expect(await settingsStore.get('parkBgColor')).toBe((global as any).DEFAULT_SETTINGS.parkBgColor);
        });

        test('should handle type validation during import', async () => {
            // Import data with wrong types that should be converted
            const importData = {
                active: 'true',  // string instead of boolean
                timeout: '3600', // string instead of number
                screenshotQuality: '95' // string instead of number
            };

            await settingsStore.fromObject(importData, false);

            // Should convert types correctly
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);
            expect(await settingsStore.get('screenshotQuality')).toBe(95);
        });

        test('should ignore unknown settings during import', async () => {
            const importData = {
                active: false,
                unknownSetting: 'shouldBeIgnored',
                anotherUnknown: 123
            };

            // Mock console.warn to capture warnings
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            await settingsStore.fromObject(importData, false);

            // Known setting should be imported
            expect(await settingsStore.get('active')).toBe(false);

            // Should warn about unknown settings
            expect(warnSpy).toHaveBeenCalledWith('Ignoring unknown setting during import: unknownSetting');
            expect(warnSpy).toHaveBeenCalledWith('Ignoring unknown setting during import: anotherUnknown');
        });

        test('should correctly import using importWithClear method', async () => {
            // Set some initial custom values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 7200);
            await settingsStore.set('parkBgColor', 'FF0000');

            // Settings to import (different from current)
            const importSettings = {
                active: true,
                timeout: 3600,
                parkBgColor: '00FF00',
                screenshotQuality: 75,
                pinned: false
            };

            // Use the new importWithClear method
            await settingsStore.importWithClear(importSettings);

            // Verify all imported values are correctly set
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);
            expect(await settingsStore.get('parkBgColor')).toBe('00FF00');
            expect(await settingsStore.get('screenshotQuality')).toBe(75);
            expect(await settingsStore.get('pinned')).toBe(false);

            // Verify unspecified settings revert to defaults
            expect(await settingsStore.get('ignoreAudible')).toBe((global as any).DEFAULT_SETTINGS.ignoreAudible);
        });

        test('should ensure all DEFAULT_SETTINGS exist after import', async () => {
            // Import minimal data
            const importData = {
                active: false
            };

            await settingsStore.fromObject(importData, false);

            // All default settings should exist, even if not in import
            const allDefaults = Object.keys((global as any).DEFAULT_SETTINGS);

            for (const key of allDefaults) {
                const value = await settingsStore.get(key);
                expect(value).toBeDefined();

                if (key === 'active') {
                    expect(value).toBe(false); // Our imported value
                } else {
                    expect(value).toBe((global as any).DEFAULT_SETTINGS[key]); // Default value
                }
            }
        });
    });

    describe('Export/Import Round Trip', () => {
        test('should maintain all settings through export/import cycle', async () => {
            // Set various custom settings
            const customSettings = {
                active: false,
                timeout: 7200,
                pinned: false,
                ignoreAudible: false,
                limitOfOpenedTabs: 50,
                parkBgColor: 'FF0000',
                screenshotQuality: 85,
                exceptionPatternsV2: '*.example.com*\n*.test.org*',
                screenshotCssStyle: 'filter: blur(2px);',
                restoreButtonView: 'topBar'
            };

            // Set all custom values
            for (const [key, value] of Object.entries(customSettings)) {
                await settingsStore.set(key, value);
            }

            // Export settings
            const exported = await settingsStore.toObject();

            // Clear current store and import (simulating fresh installation)
            await settingsStore.fromObject(exported, false);

            // Verify all settings are preserved
            for (const [key, expectedValue] of Object.entries(customSettings)) {
                const importedValue = await settingsStore.get(key);


                expect(importedValue).toBe(expectedValue);
            }

            // Verify settings not customized maintain defaults
            const defaultOnlyKeys = Object.keys((global as any).DEFAULT_SETTINGS)
                .filter(key => !Object.hasOwnProperty.call(customSettings, key));

            for (const key of defaultOnlyKeys) {
                const importedValue = await settingsStore.get(key);
                expect(importedValue).toBe((global as any).DEFAULT_SETTINGS[key]);
            }
        });
    });

    describe('Import Fix Verification', () => {
        test('importWithClear method should correctly import and preserve settings', async () => {
            // Set some initial values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 1800);

            // Verify initial values
            expect(await settingsStore.get('active')).toBe(false);
            expect(await settingsStore.get('timeout')).toBe(1800);

            // Import different values
            const importData = {
                active: true,
                timeout: 3600,
                parkBgColor: 'FF0000',
                pinned: false
            };

            // Use importWithClear method
            await settingsStore.importWithClear(importData);

            // Verify imported values are correctly set
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);
            expect(await settingsStore.get('parkBgColor')).toBe('FF0000');
            expect(await settingsStore.get('pinned')).toBe(false);

            // Verify unspecified settings have default values
            expect(await settingsStore.get('ignoreAudible')).toBe((global as any).DEFAULT_SETTINGS.ignoreAudible);
        });

        test('old buggy approach vs new importWithClear approach', async () => {
            // Simulate the OLD BUGGY approach from BGMessageListener
            const oldBuggyImportSettings = {
                active: true,
                timeout: 3600,
                parkBgColor: 'FF0000'
            };

            // OLD BUGGY: This creates wrong merged defaults
            const oldApproach = { ...(global as any).DEFAULT_SETTINGS, ...oldBuggyImportSettings };

            // The bug is that these become the "defaults", not the actual settings
            // So when you try to get() a value, it would return the default, not the "set" value

            // NEW CORRECT: Using importWithClear method
            await settingsStore.importWithClear(oldBuggyImportSettings);

            // Verify the NEW approach correctly sets the values
            expect(await settingsStore.get('active')).toBe(true);
            expect(await settingsStore.get('timeout')).toBe(3600);
            expect(await settingsStore.get('parkBgColor')).toBe('FF0000');

            // These should be defaults since not specified in import
            expect(await settingsStore.get('pinned')).toBe((global as any).DEFAULT_SETTINGS.pinned);
            expect(await settingsStore.get('ignoreAudible')).toBe((global as any).DEFAULT_SETTINGS.ignoreAudible);
        });

        test('export then import should preserve all settings using importWithClear', async () => {
            // Set some custom values
            await settingsStore.set('active', false);
            await settingsStore.set('timeout', 7200);
            await settingsStore.set('parkBgColor', '00FF00');
            await settingsStore.set('limitOfOpenedTabs', 50);

            // Export all settings
            const exported = await settingsStore.toObject();

            // Verify export contains our values
            expect(exported.active).toBe(false);
            expect(exported.timeout).toBe(7200);
            expect(exported.parkBgColor).toBe('00FF00');
            expect(exported.limitOfOpenedTabs).toBe(50);

            // Clear settings by setting different values
            await settingsStore.set('active', true);
            await settingsStore.set('timeout', 1800);
            await settingsStore.set('parkBgColor', 'FFFFFF');
            await settingsStore.set('limitOfOpenedTabs', 10);

            // Now import the exported settings using our fix
            await settingsStore.importWithClear(exported);

            // Verify all original values are restored
            expect(await settingsStore.get('active')).toBe(false);
            expect(await settingsStore.get('timeout')).toBe(7200);
            expect(await settingsStore.get('parkBgColor')).toBe('00FF00');
            expect(await settingsStore.get('limitOfOpenedTabs')).toBe(50);
        });
    });
});