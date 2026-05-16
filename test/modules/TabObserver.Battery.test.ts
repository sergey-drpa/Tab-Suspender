/**
 * TabObserver — Battery-Aware Suspension Unit Tests
 *
 * Covers TEST_CASES.md:
 *   7.1 — autoSuspendOnlyOnBatteryOnly=true, charging → no suspension
 *   7.2 — autoSuspendOnlyOnBatteryOnly=true, on battery → suspension works
 *   7.3 — enableSuspendOnlyIfBattLvlLessValue=true, batteryLevel ≥ threshold → no suspension
 *   7.4 — enableSuspendOnlyIfBattLvlLessValue=true, batteryLevel < threshold → suspension works
 *
 * Battery state comes from the `isCharging` and `batteryLevel` globals declared in
 * background.ts and updated via BGMessageListener when the offscreen document reports
 * the battery API events. TabObserver.tick() reads them directly each tick.
 */

import '../lib/Chrome';
import '../typing/global.d';

const PARK_URL = 'chrome-extension://test/park.html';
const TAB_URL  = 'https://example.com';

(global as any).sessionsPageUrl      = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl        = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl       = 'chrome-extension://test/history.html';
(global as any).parkUrl              = PARK_URL;
(global as any).publicExtensionUrl   = PARK_URL;
(global as any).trace                = false;
(global as any).debug                = false;
(global as any).debugTabsInfo        = false;
(global as any).debugScreenCache     = false;
(global as any).TSSessionId          = 123456;
(global as any).getScreenCache       = null;
(global as any).pauseTics            = 0;
(global as any).pauseTicsStartedFrom = 0;
(global as any).isCharging           = false;
(global as any).batteryLevel         = 1.0;  // 100%, not charging by default

(global as any).parseUrlParam = jest.fn((url: string, param: string) => {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
});
(global as any).extractHostname = jest.fn((url: string) => {
  try { return new URL(url).hostname; } catch { return ''; }
});

(global as any).discardTab              = jest.fn();
(global as any).markForUnsuspend        = jest.fn();
(global as any).isTabMarkedForUnsuspend = jest.fn().mockReturnValue(false);
(global as any).closeTab                = jest.fn();
(global as any).parkTab                 = jest.fn().mockResolvedValue(undefined);

let settingsOverrides: Record<string, any> = {};

(global as any).settings = {
  get: jest.fn((key: string) => {
    const defaults: Record<string, any> = {
      active: true,
      timeout: 30,
      pinned: false,
      isCloseTabsOn: false,
      limitOfOpenedTabs: 20,
      closeTimeout: 3600,
      ignoreAudible: false,
      animateTabIconSuspendTimeout: false,
      autoSuspendOnlyOnBatteryOnly: false,
      discardTabAfterSuspendWithTimeout: false,
      discardTimeoutFactor: 0.05,
      enableSuspendOnlyIfBattLvlLessValue: false,
      battLvlLessValue: 50,
      adaptiveSuspendTimeout: false,
      ignoreCloseGroupedTabs: false,
      ignoreSuspendGroupedTabs: false,
    };
    const value = key in settingsOverrides ? settingsOverrides[key]
                : key in defaults           ? defaults[key]
                : false;
    return Promise.resolve(value);
  }),
};

(global as any).whiteList  = { isURIException: jest.fn().mockReturnValue(false) };
(global as any).ignoreList = { isTabInIgnoreTabList: jest.fn().mockReturnValue(false) };
(global as any).tabCapture = { captureTab: jest.fn(), injectJS: jest.fn() };
(global as any).ContextMenuController = { menuIdMap: {} };
(global as any).ScreenshotController  = { getScreen: jest.fn() };

const BrowserActionControl = jest.fn().mockImplementation(() => ({
  updateStatus: jest.fn(),
  synchronizeActiveTabs: jest.fn(),
}));
const HistoryOpenerController = jest.fn().mockImplementation(() => ({
  onNewTab: jest.fn(), onTabUpdate: jest.fn(), onRemoveTab: jest.fn(),
  collectInitialTabState: jest.fn(),
}));
(global as any).BrowserActionControl    = BrowserActionControl;
(global as any).HistoryOpenerController = HistoryOpenerController;

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 10, url: TAB_URL, title: 'Test Tab',
    active: false, audible: false, status: 'complete',
    windowId: 1, index: 0, pinned: false,
    groupId: -1, discarded: false,
    favIconUrl: 'https://example.com/favicon.ico',
    highlighted: false, incognito: false, selected: true, autoDiscardable: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('TabObserver — Battery-Aware Suspension', () => {
  let tabManager:       any;
  let tabObserver:      any;
  let TabObserverClass: any;
  let TabManagerClass:  any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    settingsOverrides = {};
    (global as any).parkTab              = jest.fn().mockResolvedValue(undefined);
    (global as any).pauseTics            = 0;
    (global as any).pauseTicsStartedFrom = 0;
    (global as any).isCharging           = false;
    (global as any).batteryLevel         = 1.0;

    ((global as any).Date.now as jest.Mock).mockReturnValue(1640995200000);

    const { TabInfo } = require('../../modules/model/TabInfo');
    (global as any).TabInfo = TabInfo;

    const { TabManager } = require('../../modules/TabManager');
    (global as any).TabManager = TabManagerClass = TabManager;

    require('../../modules/TabObserver');
    TabObserverClass = (global as any).TabObserver;
    tabManager = new TabManagerClass();
  });

  function setWindowTab(tab: chrome.tabs.Tab) {
    (global as any).chrome.windows.getAll = jest.fn((_opts: any, cb: any) =>
      cb([{ id: 1, focused: true, tabs: [tab] }])
    );
  }

  async function runTicks(n: number) {
    for (let i = 0; i < n; i++) {
      await tabObserver.tick();
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7.1 — autoSuspendOnlyOnBatteryOnly=true, charging → no suspension
  // ══════════════════════════════════════════════════════════════════════════
  describe('7.1 — autoSuspendOnlyOnBatteryOnly=true while charging: no suspension', () => {
    it('does NOT suspend when charging even after timeout is reached', async () => {
      settingsOverrides.autoSuspendOnlyOnBatteryOnly = true;
      (global as any).isCharging = true;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // 4 ticks × 10 s = 40 s > 30 s timeout; charging blocks suspension
      await runTicks(4);

      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    it('does NOT suspend at any tick count while charging', async () => {
      settingsOverrides.autoSuspendOnlyOnBatteryOnly = true;
      (global as any).isCharging = true;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      // Run many ticks — time accumulates but suspension gate is blocked
      await runTicks(10);

      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    it('sanity: same setting with isCharging=false DOES suspend', async () => {
      settingsOverrides.autoSuspendOnlyOnBatteryOnly = true;
      (global as any).isCharging = false;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7.2 — autoSuspendOnlyOnBatteryOnly=true, on battery → suspension works
  // ══════════════════════════════════════════════════════════════════════════
  describe('7.2 — autoSuspendOnlyOnBatteryOnly=true on battery: suspension works', () => {
    it('suspends when on battery (isCharging=false) after timeout', async () => {
      settingsOverrides.autoSuspendOnlyOnBatteryOnly = true;
      (global as any).isCharging = false;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });

    it('autoSuspendOnlyOnBatteryOnly=false: suspends regardless of charging state', async () => {
      settingsOverrides.autoSuspendOnlyOnBatteryOnly = false;
      (global as any).isCharging = true; // charging, but setting is off

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // Setting is false → charging state irrelevant → still suspends
      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7.3 — enableSuspendOnlyIfBattLvlLessValue=true, level ≥ threshold → no suspend
  // ══════════════════════════════════════════════════════════════════════════
  describe('7.3 — Battery level above threshold: no suspension', () => {
    it('does NOT suspend when batteryLevel >= battLvlLessValue / 100', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = true;
      settingsOverrides.battLvlLessValue = 50;  // 50% threshold
      (global as any).batteryLevel = 0.8;       // 80% — above threshold
      (global as any).isCharging = false;        // not charging, so only batt level blocks

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // batteryLevel (0.8) >= battLvlLessValue/100 (0.5) → gate is closed
      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    it('does NOT suspend when battery level equals the threshold exactly', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = true;
      settingsOverrides.battLvlLessValue = 50;  // 50%
      (global as any).batteryLevel = 0.5;       // exactly 50% (not strictly less than)
      (global as any).isCharging = false;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // batteryLevel (0.5) < battLvlLessValue/100 (0.5) → false → no suspension
      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    it('does NOT suspend when batteryLevel is unknown (<0): disables level check, but still no suspend when charging', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = true;
      settingsOverrides.battLvlLessValue = 50;
      // batteryLevel < 0 forces enableSuspendOnlyIfBattLvlLessValue=false at line 83-84
      // That means the level gate is disabled → suspension proceeds IF charging allows.
      // With isCharging=true (charging), autoSuspendOnlyOnBattery is irrelevant but the
      // enableSuspendOnly gate is now off, so suspension depends on autoSuspendOnlyOnBatteryOnly.
      (global as any).batteryLevel = -1.0; // unknown
      (global as any).isCharging = true;   // charging prevents suspension if autoSuspendOnlyOnBatteryOnly=true

      settingsOverrides.autoSuspendOnlyOnBatteryOnly = true;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // autoSuspendOnlyOnBatteryOnly=true + isCharging=true → outer gate blocks
      expect((global as any).parkTab).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7.4 — enableSuspendOnlyIfBattLvlLessValue=true, level < threshold → suspension
  // ══════════════════════════════════════════════════════════════════════════
  describe('7.4 — Battery level below threshold: suspension works', () => {
    it('suspends when batteryLevel < battLvlLessValue / 100 and not charging', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = true;
      settingsOverrides.battLvlLessValue = 50;  // 50% threshold
      (global as any).batteryLevel = 0.3;       // 30% — below threshold
      (global as any).isCharging = false;        // not charging

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // batteryLevel (0.3) < 0.5 AND !isCharging → suspension allowed
      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });

    it('does NOT suspend if batteryLevel < threshold BUT isCharging=true', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = true;
      settingsOverrides.battLvlLessValue = 50;
      (global as any).batteryLevel = 0.2;  // 20% — below threshold
      (global as any).isCharging = true;   // charging → inner gate blocks (batteryLevel ... && !isCharging)

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // batteryLevel (0.2) < 0.5 but isCharging=true → !isCharging=false → gate fails
      expect((global as any).parkTab).not.toHaveBeenCalled();
    });

    it('enableSuspendOnlyIfBattLvlLessValue=false: suspends regardless of battery level', async () => {
      settingsOverrides.enableSuspendOnlyIfBattLvlLessValue = false;
      settingsOverrides.battLvlLessValue = 50;
      (global as any).batteryLevel = 0.9; // high battery
      (global as any).isCharging = false;

      const tab = makeTab({ active: false });
      setWindowTab(tab);
      tabObserver = new TabObserverClass(tabManager);

      await runTicks(4);

      // Setting is false → gate passes regardless of battery level
      expect((global as any).parkTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: tab.id }),
        tab.id,
      );
    });
  });
});
