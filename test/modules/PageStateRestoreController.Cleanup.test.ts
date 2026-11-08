/**
 * PageStateRestoreController — Cleanup Unit Tests
 *
 * Covers TEST_CASES.md section 12:
 *   12.6 — cleanup() removes entries older than 7000ms from tabMap
 *          and the 60s setInterval fires cleanup on schedule (this-binding fix verified)
 */

import '../lib/Chrome';
import '../typing/global.d';

// Minimum globals required before loading the module
(global as any).sessionsPageUrl  = 'chrome-extension://test/sessions.html';
(global as any).wizardPageUrl    = 'chrome-extension://test/wizard_background.html';
(global as any).historyPageUrl   = 'chrome-extension://test/history.html';
(global as any).parkUrl          = 'chrome-extension://test/park.html';
(global as any).trace            = false;
(global as any).debug            = false;
(global as any).debugScreenCache = false;
(global as any).TSSessionId      = 123456;

const BASE_TIME = 1640995200000;

describe('PageStateRestoreController — cleanup()', () => {
  let PageStateRestoreControllerClass: any;

  beforeAll(() => {
    jest.resetModules();
    require('../../modules/PageStateRestoreController');
    PageStateRestoreControllerClass = (global as any).PageStateRestoreController;
  });

  // Use fake timers for all tests — this controls both Date.now() and new Date()
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 12.6.1 — cleanup() removes entries with timestamp older than 7000ms
  // ────────────────────────────────────────────────────────────────────────────
  describe('12.6.1 — cleanup() removes outdated entries', () => {
    it('removes an entry whose timestamp is exactly 7001ms in the past', () => {
      const controller = new PageStateRestoreControllerClass();

      // Add entry at BASE_TIME
      controller.expectRestore(1, 100, 'https://example.com');

      // Advance time by 7001ms (just past the 7000ms TIMEOUT)
      jest.setSystemTime(BASE_TIME + 7001);

      controller.cleanup();

      expect(controller['tabMap'][1]).toBeUndefined();
      expect(Object.keys(controller['tabMap']).length).toBe(0);
    });

    it('keeps an entry whose timestamp is only 6999ms in the past', () => {
      const controller = new PageStateRestoreControllerClass();

      controller.expectRestore(2, 200, 'https://fresh.com');

      // Advance time by 6999ms (still within TIMEOUT)
      jest.setSystemTime(BASE_TIME + 6999);

      controller.cleanup();

      // Entry should still be present
      const entry = controller['tabMap'][2];
      expect(entry).toBeDefined();
      expect(entry.url).toBe('https://fresh.com');
    });

    it('removes only outdated entries and keeps fresh ones', () => {
      const controller = new PageStateRestoreControllerClass();

      // Add an "old" entry at BASE_TIME
      controller.expectRestore(10, 1000, 'https://old.com');

      // Advance time 5000ms, add a "fresh" entry
      jest.setSystemTime(BASE_TIME + 5000);
      controller.expectRestore(20, 2000, 'https://fresh.com');

      // Advance to BASE_TIME + 7001 — entry 10 (age 7001ms) is outdated;
      // entry 20 (age 2001ms) is still fresh
      jest.setSystemTime(BASE_TIME + 7001);

      controller.cleanup();

      expect(controller['tabMap'][10]).toBeUndefined(); // outdated — removed
      expect(controller['tabMap'][20]).toBeDefined();   // fresh — kept
    });

    it('cleanup() on an empty tabMap does not throw', () => {
      const controller = new PageStateRestoreControllerClass();
      expect(() => controller.cleanup()).not.toThrow();
    });

    it('removes multiple outdated entries in one cleanup() call', () => {
      const controller = new PageStateRestoreControllerClass();

      controller.expectRestore(1, 10, 'https://a.com');
      controller.expectRestore(2, 20, 'https://b.com');
      controller.expectRestore(3, 30, 'https://c.com');

      jest.setSystemTime(BASE_TIME + 8000); // all 3 are now outdated

      controller.cleanup();

      expect(Object.keys(controller['tabMap']).length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 12.6.2 — 60s setInterval fires cleanup (this-binding bug fix verification)
  // ────────────────────────────────────────────────────────────────────────────
  describe('12.6.2 — 60s interval fires cleanup with correct this-binding', () => {
    it('cleanup() called via interval removes outdated entries without this-binding error', () => {
      const controller = new PageStateRestoreControllerClass();

      // Add an entry
      controller.expectRestore(99, 999, 'https://interval-test.com');
      expect(Object.keys(controller['tabMap']).length).toBe(1);

      // Advance Date past TIMEOUT so entry will be outdated when cleanup runs
      jest.setSystemTime(BASE_TIME + 8000);

      // Advance fake timers by 60 seconds — triggers the setInterval callback.
      // BUG (before fix): `this` was undefined inside cleanup(), causing
      // "Cannot read properties of undefined" crash.
      // After fix (arrow function wrapper), `this` is the controller instance.
      expect(() => jest.advanceTimersByTime(60000)).not.toThrow();

      // Entry should have been cleaned up by the interval callback
      expect(Object.keys(controller['tabMap']).length).toBe(0);
    });

    it('interval fires cleanup repeatedly every 60 seconds', () => {
      const controller = new PageStateRestoreControllerClass();

      // First batch of entries at BASE_TIME
      controller.expectRestore(1, 10, 'https://a.com');
      controller.expectRestore(2, 20, 'https://b.com');
      expect(Object.keys(controller['tabMap']).length).toBe(2);

      // First interval fire — entries are now outdated
      jest.setSystemTime(BASE_TIME + 8000);
      jest.advanceTimersByTime(60000);
      expect(Object.keys(controller['tabMap']).length).toBe(0);

      // Second batch of entries
      jest.setSystemTime(BASE_TIME + 60000);
      controller.expectRestore(3, 30, 'https://c.com');
      expect(Object.keys(controller['tabMap']).length).toBe(1);

      // Second interval fire — entry is now outdated
      jest.setSystemTime(BASE_TIME + 68000);
      jest.advanceTimersByTime(60000);
      expect(Object.keys(controller['tabMap']).length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 12.6.3 — getTargetMapEntry returns null for outdated entries
  // ────────────────────────────────────────────────────────────────────────────
  describe('12.6.3 — getTargetMapEntry respects TIMEOUT', () => {
    it('returns null for an entry that is outdated (age > 7000ms)', () => {
      const controller = new PageStateRestoreControllerClass();
      controller.expectRestore(5, 500, 'https://stale.com');

      jest.setSystemTime(BASE_TIME + 7001);

      expect(controller.getTargetMapEntry(5)).toBeNull();
    });

    it('returns entry data for a fresh entry (age <= 7000ms)', () => {
      const controller = new PageStateRestoreControllerClass();
      controller.expectRestore(6, 600, 'https://live.com');

      // At exactly 7000ms: Date.now() - timestamp = 7000, NOT > 7000, so valid
      jest.setSystemTime(BASE_TIME + 7000);

      const entry = controller.getTargetMapEntry(6);
      expect(entry).not.toBeNull();
      expect(entry.url).toBe('https://live.com');
      expect(entry.storedAsTabId).toBe(600);
    });

    it('returns undefined for a tab ID that was never added', () => {
      const controller = new PageStateRestoreControllerClass();
      expect(controller.getTargetMapEntry(9999)).toBeUndefined();
    });
  });
});
