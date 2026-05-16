---
name: E2E Puppeteer test suite (Tab Suspender)
description: Status and key lessons from building the full Puppeteer E2E test suite
type: project
originSessionId: ac08b630-b6e4-4ce5-a1f7-3ee65c2f0dd0
---
Full E2E test suite implemented in `test/puppeteer/`. Coverage: 68/103 cases (66%) per TEST_CASES.md.

**Key files:**
- `base/ExtensionHelper.ts` — shared helpers: `evalInSW`, `waitForExtensionInit`, `getSetting`/`setSetting`, `suspendTabById`, `waitForParkPages`, `getParkPages`, etc.
- `docs/TEST_CASES.md` — full test case catalog with ✅/⚠️/❌ status

**18 test files:**
basic-suspend-restore, auto-restore-tab, restore-modes, form-data-restore, protected-urls, whitelist-ignore, favicon-loss, favicon-nav-stress, screenshot-settings, discard-tab-id-change, unfocused-tab-discard, corrupt-storage, start-discarded, bulk-tab-operations, adaptive-timeout, pinned-tab-protection, hover-restore, url-param-preserve

**Session dirs:** All `.test-session-*` dirs live under `test/puppeteer/test-session/` (migrated from top-level `test/puppeteer/`).

**Why:** Needed to validate all extension features that can't be covered by Jest unit tests.

**How to apply:** When adding new features, check TEST_CASES.md for relevant test cases. Most common pattern: `waitForExtensionInit(browser)` must be called before any `getSetting`/`setSetting` calls — SW `let` variables (whiteList, ignoreList, tabManager) are assigned asynchronously.

**Critical gotchas discovered:**
- `parkTab()` bypasses whitelist — only `parkTabs()` calls `isExceptionTab()`; tests must use `parkTabs()` to verify whitelist protection
- `openUnfocusedTabDiscarded` only triggers if tab has `favIconUrl` set during `status='loading'` — need a local HTTP server with streaming response + inline favicon
- `screenshot-settings.test.ts` must check `#screen` element specifically (park.html has other `data:image` icons for UI)
- `start-discarded.test.ts` auto-discard condition in park.ts has a bug (tab.active===false after active:true query is always false) — test verifies the settings path and `[AutomaticTabCleaner:DiscardTab]` handler instead
- **Timer-based auto-suspend gotcha** (`basic-suspend-restore.test.ts`): Chrome always opens a `wizard_background.html` extension tab on fresh browser launch. That tab accumulates inactivity time before the test starts. When `timeout=10` is set, the wizard tab is suspended BEFORE the example.com tab on the first tick. Fix: close all non-park extension tabs before setting the low timeout, then poll specifically for the target tab to become park.html (not just any park page). Pattern: `chrome.tabs.remove(wizardTabId)` + targeted poll loop.
- **Tab ID after parkTab**: `parkTab()` called from the timer navigates the same tab in-place to park.html (via `chrome.tabs.update(tab.id, {url})`), so `parkedTabId === originalTabId`. No new tab is created when a screenshot already exists.
- **Adaptive timeout test** (`adaptive-timeout.test.ts`, test 1.8): Must use exact URL match `t.url === TARGET_URL` (not `.includes('example.com')`) — park.html encodes the original URL as a query param so `.includes()` matches the wrong tab. Also reset `_parkedCount=0` and `_time=0` alongside `_swch_cnt`/`_active_time` via `evalInSW` before each phase. Return `{ page, blank, tabId }` from `openAndSetup()` and close both after each phase to prevent tab ID reuse.
- **Pinned tab protection** (`pinned-tab-protection.test.ts`, tests 5.1/5.2): With `timeout=20 > tickSize=10`, `pinned=true` resets `tabInfo._time=0` at end of each tick — threshold never reached. Test waits 35s (3+ ticks). `pinned=false` removes protection; tab accumulates normally and gets suspended.
- **Hover restore** (`hover-restore.test.ts`, test 2.6): The restore icon DOM id is `resoteImg` (intentional typo in park.ts — NOT `restoreImg`). Use `getParkPages(browser, extensionId)` to get the puppeteer Page. `waitForSelector('#resoteImg', {visible:true})` fires at DOMContentLoaded, but the `onmouseover` handler is wired up LATER inside `applyRestoreButtonView()` (called from `drawContent()` after screenPromise settles, up to 2.5s). Must wait with `waitForFunction(() => !!document.getElementById('resoteImg')?.onmouseover)`. Puppeteer's `page.hover()` doesn't reliably fire `onmouseover` on extension pages — use `page.evaluate(() => el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true})))` instead. After `goBack()` runs, the evaluate call throws "Execution context was destroyed" — catch and ignore it.
- **`unsuspendTabById` requires park page to be ready**: `unsuspendTabById` sends a `chrome.runtime.sendMessage` that the park page must have already registered a listener for. Add `await sleep(600)` after `waitForParkPages` before calling `unsuspendTabById`, otherwise the message is sent before `chrome.runtime.onMessage.addListener` runs in park.html and the restore never happens.
