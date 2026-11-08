/**
 * OffscreenDocument — Service Worker Heartbeat Unit Tests
 *
 * Covers TEST_CASES.md:
 *   16.1 — Offscreen document sends heartbeat every 20s to keep SW alive
 *
 * offscreenDocument.ts executes immediately on require():
 *   - setTimeout(startBatteryStatusNotifier, 3500) — tries navigator.getBattery(), safe via try/catch
 *   - setTimeout(startServiceWorkerHeartbeat, 4000) — sets up 20s interval
 *   - setTimeout(initBackupSync, 5000) — getElementById returns null in jsdom → early return
 *   - chrome.runtime.onMessage.addListener(...) — must be mocked BEFORE require()
 */

import '../lib/Chrome';
import '../typing/global.d';

describe('16.1 — Offscreen document sends heartbeat every 20s to keep SW alive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.resetModules();

    // chrome.runtime.onMessage is not in Chrome.ts mock — add it before require()
    (global as any).chrome.runtime.onMessage = { addListener: jest.fn() };
    // Ensure sendMessage mock is fresh
    (global as any).chrome.runtime.sendMessage = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends heartbeat message to keep service worker alive after initialization', () => {
    require('../../offscreenDocument');

    // Advance to 4100ms: fires startBatteryStatusNotifier (3500ms, safe via try/catch)
    // and startServiceWorkerHeartbeat (4000ms, registers the 20s interval)
    jest.advanceTimersByTime(4100);

    // Advance 20s: fires the first heartbeat interval tick
    // initBackupSync fires at 5000ms during this advance: getElementById returns null → early return
    jest.advanceTimersByTime(20000);

    expect((global as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: '[TS:offscreenDocument:heartbeat]' }),
    );
  });

  it('sends heartbeat on every subsequent 20s interval', () => {
    require('../../offscreenDocument');

    jest.advanceTimersByTime(4100);
    jest.advanceTimersByTime(60000); // 3 interval ticks

    const heartbeatCalls = ((global as any).chrome.runtime.sendMessage as jest.Mock)
      .mock.calls.filter((args: any[]) => args[0]?.method === '[TS:offscreenDocument:heartbeat]');

    expect(heartbeatCalls.length).toBe(3);
  });

  it('does NOT send heartbeat before 20s interval fires', () => {
    require('../../offscreenDocument');

    // Advance past startServiceWorkerHeartbeat (4000ms) but not 20s beyond it
    jest.advanceTimersByTime(4100);

    const heartbeatCalls = ((global as any).chrome.runtime.sendMessage as jest.Mock)
      .mock.calls.filter((args: any[]) => args[0]?.method === '[TS:offscreenDocument:heartbeat]');

    expect(heartbeatCalls.length).toBe(0);
  });

  it('registers onMessage listener immediately on load', () => {
    require('../../offscreenDocument');

    expect((global as any).chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  });

  it('7.5 — Battery API unavailable: heartbeat still works, no crash', () => {
    // navigator.getBattery is undefined in jsdom — startBatteryStatusNotifier catches the
    // TypeError in its try/catch and continues. The heartbeat interval is unaffected.
    require('../../offscreenDocument');

    jest.advanceTimersByTime(4100);  // startServiceWorkerHeartbeat fires (4000ms)
    jest.advanceTimersByTime(20000); // first heartbeat interval tick

    // Heartbeat must still fire despite battery API failure
    expect((global as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: '[TS:offscreenDocument:heartbeat]' }),
    );
  });

  it('7.5 — Battery API unavailable: no sendMessage call from battery notifier', () => {
    require('../../offscreenDocument');

    // Advance only past battery notifier (3500ms) but NOT past heartbeat interval (4000ms + 20s)
    jest.advanceTimersByTime(3600);

    // getBattery failed — no battery status message should have been sent
    const battCalls = ((global as any).chrome.runtime.sendMessage as jest.Mock)
      .mock.calls.filter((args: any[]) =>
        args[0]?.method === '[TS:offscreenDocument:batteryStatusChanged]',
      );
    expect(battCalls.length).toBe(0);
  });
});
