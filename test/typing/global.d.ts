// Global type definitions for tests

declare global {
  // Global variables referenced in TabManager
  const sessionsPageUrl: string;
  const wizardPageUrl: string;
  const historyPageUrl: string;
  const parkUrl: string;
  const trace: boolean;
  const debug: boolean;
  const debugScreenCache: boolean;
  const TSSessionId: number;

  // Global functions
  function parseUrlParam(url: string, param: string): string;
  function extractHostname(url: string): string;
  function discardTab(tabId: number): void;
  function markForUnsuspend(tab: chrome.tabs.Tab): void;

  // Global objects
  const settings: any;
  const whiteList: any;
  const ignoreList: any;
  const tabCapture: any;
  const tabManager: any;
  const ContextMenuController: any;
  const pauseTics: any;
  const ScreenshotController: any;

  // Global cache objects
  let getScreenCache: any;

  // Interfaces
  interface TabChangeInfo {
    status?: string;
    url?: string;
    discarded?: boolean;
    [key: string]: any;
  }

  interface TabInfo {
    id: number;
    oldRefId?: number;
    originRefId?: number;
    newRefId?: number;
    winId: number;
    idx: number;
    time: number;
    suspended_time: number;
    active_time: number;
    swch_cnt: number;
    parkTrys: number;
    lstCapUrl: string;
    v: number;
    suspendPercent: number;
    discarded: boolean;
    markedForDiscard: boolean;
    parkedCount: number;
    nonCmpltInput: boolean;
    refreshIconRetries: number;
    zoomFactor: number;
    closed?: TabInfoClosedInfo;
    parked: boolean;
    parkedUrl: string;
    lstCapTime: number;
    lstSwchTime: number;
  }

  interface TabInfoClosedInfo {
    at: number;
    tsSessionId: number;
  }

  interface ITabInfo extends TabInfo {}

  interface CaptureTabOptions {
    checkActiveTabNotChanged?: boolean;
  }

  interface IntOptions {
    reloadSettings?: boolean;
  }
}

export {};