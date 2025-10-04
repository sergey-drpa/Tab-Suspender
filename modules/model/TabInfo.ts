interface ITabInfo {
	id: number;
	oldRefId: number;
	originRefId: number;
	newRefId: number;
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
	closed: TabInfoClosedInfo;

	// Dynamic fields
	parked: boolean;
	parkedUrl: string;
	lstCapTime: number;
	lstSwchTime: number;
	missingCheckTime: number;
}

interface TabInfoClosedInfo {
	at: number;
	tsSessionId: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TabInfo implements ITabInfo {

	private _id: number;
	private _oldRefId: number;
	private _originRefId: number;
	private _newRefId: number;
	private _winId: number;
	private _idx: number;
	private _time: number;
	private _suspended_time: number;
	private _active_time: number;
	private _swch_cnt: number;
	private _parkTrys: number;
	private _lstCapUrl: string;
	private _v: number;
	private _suspendPercent: number;
	private _discarded: boolean;
	private _markedForDiscard: boolean;
	private _parkedCount: number;
	private _nonCmpltInput: boolean;
	private _refreshIconRetries: number;
	private _zoomFactor: number;

	// Dynamic fields
	private _closed: TabInfoClosedInfo;
	private _parked: boolean | null;
	private _parkedUrl: string;
	private _lstCapTime: number;
	private _lstSwchTime: number;
	private _missingCheckTime: number;

	constructor(tab: chrome.tabs.Tab) {
		this._id = tab.id;
		this._winId = tab.windowId;
		this._idx = tab.index;
		this._lstCapUrl = tab.url;
		this._discarded = tab.discarded;
		this._time = 0;
		this._suspended_time = 0;
		this._active_time = 0;
		this._swch_cnt = 0;
		this._parkTrys = 0;
		this._v = 2;
		this._suspendPercent = 0;
		this._markedForDiscard = false;
		this._parkedCount = 0;
		this._nonCmpltInput = false;
		this._refreshIconRetries = 0;
		// Dynamic fields
		this._parked = null;
		this._parkedUrl = null;
		this._lstCapTime = null;
		this._lstSwchTime = null;
		this._missingCheckTime = null;
	}

	toObject(): ITabInfo {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		const object = {};

		Object.getOwnPropertyNames(this).forEach(
			function(propName: string) {
				if (propName.startsWith('_')) {
					object[propName.substring(1)] = self[propName];
				}
			}
		);

		return <ITabInfo>object;
	}

	static fromObject(iTabInfo: ITabInfo): TabInfo {

		const tabInfo = new TabInfo(<chrome.tabs.Tab>{});

		Object.getOwnPropertyNames(iTabInfo).forEach(
			function(propName: string) {
				tabInfo[propName] = iTabInfo[propName];
			}
		);

		return tabInfo;
	}

	get id(): number {
		return this._id;
	}

	set id(value: number) {
		this._id = value;
	}

	get oldRefId(): number {
		return this._oldRefId;
	}

	set oldRefId(value: number) {
		this._oldRefId = value;
	}

	get originRefId(): number {
		return this._originRefId;
	}

	set originRefId(value: number) {
		this._originRefId = value;
	}

	get newRefId(): number {
		return this._newRefId;
	}

	set newRefId(value: number) {
		this._newRefId = value;
	}

	get winId(): number {
		return this._winId;
	}

	set winId(value: number) {
		this._winId = value;
	}

	get idx(): number {
		return this._idx;
	}

	set idx(value: number) {
		this._idx = value;
	}

	get time(): number {
		return this._time;
	}

	set time(value: number) {
		this._time = value;
	}

	get suspended_time(): number {
		return this._suspended_time;
	}

	set suspended_time(value: number) {
		this._suspended_time = value;
	}

	get active_time(): number {
		return this._active_time;
	}

	set active_time(value: number) {
		this._active_time = value;
	}

	get swch_cnt(): number {
		return this._swch_cnt;
	}

	set swch_cnt(value: number) {
		this._swch_cnt = value;
	}

	get parkTrys(): number {
		return this._parkTrys;
	}

	set parkTrys(value: number) {
		this._parkTrys = value;
	}

	get lstCapUrl(): string {
		return this._lstCapUrl;
	}

	set lstCapUrl(value: string) {
		this._lstCapUrl = value;
	}

	get v(): number {
		return this._v;
	}

	set v(value: number) {
		this._v = value;
	}

	get suspendPercent(): number {
		return this._suspendPercent;
	}

	set suspendPercent(value: number) {
		this._suspendPercent = value;
	}

	get discarded(): boolean {
		return this._discarded;
	}

	set discarded(value: boolean) {
		this._discarded = value;
	}

	get markedForDiscard(): boolean {
		return this._markedForDiscard;
	}

	set markedForDiscard(value: boolean) {
		this._markedForDiscard = value;
	}

	get parkedCount(): number {
		return this._parkedCount;
	}

	set parkedCount(value: number) {
		this._parkedCount = value;
	}

	get nonCmpltInput(): boolean {
		return this._nonCmpltInput;
	}

	set nonCmpltInput(value: boolean) {
		this._nonCmpltInput = value;
	}

	get refreshIconRetries(): number {
		return this._refreshIconRetries;
	}

	set refreshIconRetries(value: number) {
		this._refreshIconRetries = value;
	}

	get parked(): boolean | null {
		return this._parked;
	}

	set parked(value: boolean | null) {
		this._parked = value;
	}

	get parkedUrl(): string {
		return this._parkedUrl;
	}

	set parkedUrl(value: string) {
		this._parkedUrl = value;
	}

	get lstCapTime(): number {
		return this._lstCapTime;
	}

	set lstCapTime(value: number) {
		this._lstCapTime = value;
	}

	get lstSwchTime(): number {
		return this._lstSwchTime;
	}

	set lstSwchTime(value: number) {
		this._lstSwchTime = value;
	}

	get zoomFactor(): number {
		return this._zoomFactor;
	}

	set zoomFactor(value: number) {
		this._zoomFactor = value;
	}

	get closed(): TabInfoClosedInfo {
		return this._closed;
	}

	set closed(value: TabInfoClosedInfo) {
		this._closed = value;
	}

	get missingCheckTime(): number {
		return this._missingCheckTime;
	}

	set missingCheckTime(value: number) {
		this._missingCheckTime = value;
	}
}

if (typeof module != 'undefined')
	module.exports = {
		TabInfo,
	}