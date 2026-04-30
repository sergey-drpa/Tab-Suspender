// Mirrors the private _* fields that TabInfo serializes via JSON.stringify
export interface TabInfoSnapshot {
  _id: number;
  _parked: boolean | null;
  _parkedUrl: string | null;
  _oldRefId: number | null;
  _newRefId: number | null;
  _originRefId: number | null;
  _closed: { at: number; tsSessionId: number } | null;
  _lstCapUrl: string | null;
  _lstCapTime: number | null;
  _lstSwchTime: number | null;
  _time: number;
  _suspended_time: number;
  _active_time: number;
  _discarded: boolean;
  _missingCheckTime: number | null;
}

// keyed by string tab-id
export type TabInfosMap = Record<string, TabInfoSnapshot>;

export interface ChromeTab {
  id: number;
  url: string;
  title?: string;
  discarded: boolean;
  status?: string;
  windowId: number;
  index: number;
}

export interface TestState {
  extensionId: string;
  parkTabIds: number[];
  timestamp: string;
}
