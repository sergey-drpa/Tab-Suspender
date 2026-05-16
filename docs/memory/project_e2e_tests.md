---
name: E2E Puppeteer test suite (Tab Suspender)
description: Status and key lessons from building the full Puppeteer E2E test suite + Jest unit tests
type: project
originSessionId: ac08b630-b6e4-4ce5-a1f7-3ee65c2f0dd0
---
Full test suite: 89/103 cases (86%) covered per TEST_CASES.md (as of 2026-05-16).

**18 Puppeteer E2E test files (test/puppeteer/):**
basic-suspend-restore, auto-restore-tab, restore-modes, form-data-restore, protected-urls, whitelist-ignore, favicon-loss, favicon-nav-stress, screenshot-settings, discard-tab-id-change, unfocused-tab-discard, corrupt-storage, start-discarded, bulk-tab-operations, adaptive-timeout, pinned-tab-protection, hover-restore, url-param-preserve

**Key Jest unit test files added this project (test/modules/):**
- `TabObserver.Battery.test.ts` — 7.1, 7.2, 7.3, 7.4 (battery-aware suspension)
- `TabObserver.AutoClose.test.ts` — 8.1, 8.2, 8.3, 8.5 (auto-close with rank formula)
- `TabObserver.Discard.test.ts` — 9.1, 9.2 (discard after suspend)
- `TabObserver.FaviconRetry.test.ts` — 4.9 (favicon retry up to 2 times)
- `TabObserver.ActiveTabAudible.test.ts` — 5.3, 5.4 (audible tab protection + resume)
- `TabObserver.SettingsChange.test.ts` — 11.4 (settings change applied immediately)
- `WhiteList.test.ts` — extended with 3.6, 3.7 (empty/invalid patterns)
- `TabCapture.test.ts` — extended with 14.2, 14.3, 14.4 (error handling edge cases)
- `CtrlClickSuspend.test.ts` — extended with 10.3/4.10 (no screenshot on ctrl+click)

**Session dirs:** All `.test-session-*` dirs live under `test/puppeteer/test-session/`

**Critical gotchas (Puppeteer E2E):**
- `parkTab()` bypasses whitelist — only `parkTabs()` calls `isExceptionTab()`
- `openUnfocusedTabDiscarded` only triggers if tab has `favIconUrl` set during `status='loading'`
- `screenshot-settings.test.ts` must check `#screen` element specifically
- **Timer-based auto-suspend gotcha**: Chrome opens wizard_background.html tab — close it before setting low timeout
- **Tab ID after parkTab**: same tab ID is preserved (no new tab created)
- **Adaptive timeout test**: Use exact URL match (not `.includes()`) to avoid park.html query param collision
- **Pinned tab protection**: With `timeout=20 > tickSize=10`, pinned resets `_time=0` each tick — wait 35s (3+ ticks)
- **Hover restore**: DOM id is `resoteImg` (typo in source). `waitForFunction(() => !!el?.onmouseover)` needed. Use `dispatchEvent` not `page.hover()`
- **`unsuspendTabById` timing**: Add `await sleep(600)` after `waitForParkPages` to let park.html register its message listener

**Critical gotchas (Jest unit tests):**
- `flushPromises(30)`: AutoClose tests need 30 sequential `await Promise.resolve()` due to deep `isExceptionTab()` → `settings.get()` chains
- `jest.advanceTimersByTime(3000)` NOT `runAllTimers` for favicon retry (avoids infinite setInterval)
- Mock leak: `mockReturnValue()` persists across tests — use `afterEach` to restore, or `mockReturnValueOnce()`
- `isCharging` and `batteryLevel` are `let` globals in background.ts — set via `(global as any).isCharging` before each test
- Battery read in TabObserver is TODO-v3 commented out — battery state only comes via BGMessageListener from offscreen document

**Bugs found in core logic:**
1. `TabObserver.ts` ~line 158: `if (oneTabClosed) break;` — unreachable dead code
2. `TabObserver.ts`: `tabInfo.discarded = tab.discarded` resets flag every tick (potential re-trigger race)
3. `TabObserver.ts`: Typo "Disacrd failed" in error message
4. `TabCapture.ts:51`: `reject()` called with no argument when active tab changes — rejection reason is undefined, hard to debug
5. `PageStateRestoreController.ts:21`: `setInterval(this.cleanup, 60000)` — `this` binding lost in callback; cleanup silently fails every 60s (should use arrow function or `.bind(this)`)

**Why:** Needed to validate all extension features that can't be covered by manual testing alone.

**How to apply:** When adding new features, check TEST_CASES.md for relevant test cases. Most common pattern: `waitForExtensionInit(browser)` must be called before any `getSetting`/`setSetting` calls. For unit tests, set battery globals before requiring TabObserver; for mock state, prefer `afterEach` restore over `beforeEach` reset for non-reassigned mock properties.
