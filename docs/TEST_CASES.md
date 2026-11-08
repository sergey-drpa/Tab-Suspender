# Tab Suspender — Test Cases

**Priorities:** P0 = critical, P1 = high, P2 = medium, P3 = low
**Type:** Unit = Jest, E2E = Puppeteer, Both = both required
**Status:** ✅ covered, ⚠️ partial, ❌ not covered

---

## 1. AUTO-SUSPEND

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 1.1 | Tab suspends after the configured timeout (30 min default) | P0 | E2E | ✅ | `basic-suspend-restore.test.ts` |
| 1.2 | Active tab is NOT suspended even when timeout has elapsed | P0 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.3 | When a tab is activated its timer resets to 0 | P0 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.4 | Tab with `status !== 'complete'` is not suspended | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.5 | Extension disabled (`active=false`) → no tab is suspended | P1 | Unit | ✅ | `ActiveDisabled.test.ts` |
| 1.6 | Pause (`pauseTics > 0`) prevents suspension | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.7 | After pause expires suspension resumes | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.8 | Adaptive timeout grows with visit frequency | P2 | E2E | ✅ | `adaptive-timeout.test.ts` |
| 1.9 | Suspension is idempotent — repeated calls do not break state | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.10 | Tab closed during suspension — no errors | P1 | Unit | ✅ | `AutoSuspension.test.ts` |

---

## 2. TAB RESTORE

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 2.1 | Click on park.html → tab restores to original URL | P0 | E2E | ✅ | `basic-suspend-restore.test.ts` |
| 2.2 | `autoRestoreTab=true` → activating a suspended tab restores it automatically | P1 | E2E | ✅ | `auto-restore-tab.test.ts` |
| 2.3 | `reloadTabOnRestore=false` → restore via history (bfcache) | P1 | E2E | ✅ | `restore-modes.test.ts` |
| 2.4 | `reloadTabOnRestore=true` → forced navigation to original URL | P1 | E2E | ✅ | `restore-modes.test.ts` |
| 2.5 | After restore the flags `parked`, `time`, `suspended_time` are reset | P1 | Unit | ✅ | `TabRestore.test.ts` |
| 2.6 | Hover on icon restores tab (`restoreOnMouseHover=true`) | P2 | E2E | ✅ | `hover-restore.test.ts` |
| 2.7 | Re-restoring an already-restored tab causes no errors | P1 | Unit | ✅ | `TabRestore.test.ts` |
| 2.8 | Forms filled before suspension → data restored after | P1 | E2E | ✅ | `form-data-restore.test.ts` |
| 2.9 | YouTube: video timestamp preserved and restored in URL | P2 | E2E | ✅ | `url-param-preserve.test.ts` |
| 2.10 | Bulk-restore all tabs in a window — with delay between each | P2 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase B |

---

## 3. WHITELIST / BLACKLIST

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 3.1 | `*.google.com*` matches `mail.google.com` and `drive.google.com` | P0 | Unit | ✅ | `WhiteList.test.ts` |
| 3.2 | Pattern with `*` at start, middle, and end | P1 | Unit | ✅ | `WhiteList.test.ts` |
| 3.3 | Tab matching whitelist is not suspended | P0 | Unit | ✅ | `WhiteList.test.ts` |
| 3.4 | Add URL from context menu → saved to settings | P1 | E2E | ✅ | `whitelist-ignore.test.ts` Phase A |
| 3.5 | Remove pattern → tab becomes a suspension candidate again | P1 | E2E | ✅ | `whitelist-ignore.test.ts` Phase B |
| 3.6 | Empty pattern is skipped without errors | P2 | Unit | ✅ | `WhiteList.test.ts` |
| 3.7 | Invalid regex — caught, extension does not crash | P2 | Unit | ✅ | `WhiteList.test.ts` |
| 3.8 | chrome:// and extension:// URLs are never suspended | P0 | E2E | ✅ | `protected-urls.test.ts` |
| 3.9 | "Ignore tab" (per-session) — tab not suspended until restart | P2 | E2E | ✅ | `whitelist-ignore.test.ts` Phase C |

---

## 4. FAVICON AND SCREENSHOTS

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 4.1 | SVG favicon with explicit width/height — not lost on suspend | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase A |
| 4.2 | SVG favicon without width/height (viewBox only) — renders correctly | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase B |
| 4.3 | Full cycle suspend→discard→restore, favicon preserved | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase C |
| 4.4 | Favicon not lost when navigating multiple pages before suspend | P1 | E2E | ✅ | `favicon-nav-stress.test.ts` |
| 4.5 | Screenshot captured before suspend and shown on park.html | P1 | E2E | ✅ | `screenshot-settings.test.ts` Phase A |
| 4.6 | `screenshotsEnabled=false` → park.html shows only title and icon | P2 | E2E | ✅ | `screenshot-settings.test.ts` Phase B |
| 4.7 | Screenshot is gzip-compressed and stored in IndexedDB | P2 | Unit | ⚠️ | `ScreenshotController.test.ts` |
| 4.8 | Screenshot capture timeout — suspension still happens without it | P1 | Unit | ✅ | `ParkPageScreenshotTimeout.test.ts` |
| 4.9 | Favicon capture retried up to 2 times (100 ms) when `favIconUrl` is empty | P2 | Unit | ✅ | `TabObserver.FaviconRetry.test.ts` |
| 4.10 | Screenshot NOT captured during Ctrl+Click suspension | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |
| 4.11 | Screenshot quality setting is forwarded to `captureVisibleTab` (10% vs 100%) | P3 | Unit | ✅ | `TabCapture.test.ts` |

---

## 5. PINNED / AUDIBLE / GROUPED TABS

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 5.1 | Pinned tab with `pinned=true` → NOT suspended | P0 | E2E | ✅ | `pinned-tab-protection.test.ts` Phase A |
| 5.2 | Pinned tab with `pinned=false` → suspended after timeout | P1 | E2E | ✅ | `pinned-tab-protection.test.ts` Phase B |
| 5.3 | Audible tab with `ignoreAudible=true` → timer does not accumulate | P1 | Unit | ✅ | `ActiveTabAudible.test.ts` |
| 5.4 | Tab stops playing audio → timer resumes | P1 | Unit | ✅ | `TabObserver.ActiveTabAudible.test.ts` |
| 5.5 | Grouped tab with `ignoreSuspendGroupedTabs=true` → NOT suspended | P1 | Unit | ✅ | `TabGroupSuspend.test.ts` |
| 5.6 | Suspend tab group via "Suspend Tab Group" command | P1 | Unit | ✅ | `TabGroupSuspend.test.ts` |
| 5.7 | Restore tab group with 1 s delay between tabs | P2 | Unit | ✅ | `UnsuspendCurrentTabInGroup.test.ts` |
| 5.8 | Restore only the current tab in a group (not the whole group) | P2 | Unit | ✅ | `UnsuspendCurrentTabInGroup.test.ts` |
| 5.9 | Tab group fix on browser session restore | P2 | Unit | ✅ | `GroupRestoreFix.test.ts` |
| 5.10 | Collapsed grouped tabs stay parked after browser restart | P2 | E2E | ✅ | `tab-group-session-restore.test.ts` + collapsed, autoRestore, race variants; fixed `TabManager.loadTabInfos()` to preserve live reconstructed `parked`/`parkedUrl` against stale persisted snapshot |
| 5.11 | Grouped parked tab with `TabInfo.parkedUrl=null` after double ID replacement — restore does not navigate to blank/new-tab | P0 | E2E | ✅ | `tab-group-blank-endstate-regression.test.ts`; Issue #4 fix: `BGMessageListener.buildParkPageData` recovers `parkedUrl` from the live `park.html?url=` query when the persisted `TabInfo.parkedUrl` is null/blank; `TabManager.onTabReplaceDetected` preserves `TabInfo` class instance (replaces `structuredClone` with `TabInfo.fromObject`), repairs stale `parkedUrl` from the live park.html URL, and `unsuspendTab`/`park.ts goBack()` validate restore URL via `isInvalidRestoreUrl` with fallbacks |
| 5.12 | After session restore, clicking/hovering restore on a grouped parked tab with broken `TabInfo.parkedUrl=null` navigates to the ORIGINAL url — not back to `park.html`, not to `about:blank` | P0 | E2E | ✅ | `tab-group-blank-url-revert.test.ts`; Issue #4 fix: `park.ts goBack()` only uses `historyFallback` (`history.go(-1)`) when `restoredFromStorage === false` — post-restart bfcache is gone so `history.go(-1)` lands on `about:blank`; the `restoredFromStorage` flag on `TabInfo` (set in `loadTabInfos`) signals this. `BGMessageListener.buildParkPageData` forwards `restoredFromStorage` and recovers `parkedUrl` from the live `park.html?url=` query when persisted `TabInfo.parkedUrl` is null. |
| 5.13 | After browser restart, grouped parked tabs whose URL was replaced with `about:blank` by Chrome session restore (BEFORE the service worker started) are recovered to `park.html?url=ORIGINAL_URL` | P0 | E2E | ✅ | `tab-group-restart-blank-recovery.test.ts`; Issue #4 fix: `TabManager.recoverBlankParkedTabsOnStartup()` runs after `loadTabInfos()` — scans all live tabs, walks the `newRefId` chain from each persisted `parked=true` TabInfo to find the live tab, and reverts any blank grouped parked tab back to `park.html?tabId=...&url=ORIGINAL_URL`. This catches the URL replacement that the `tabs.onUpdated` listener missed (because it happened before the SW started). The test does a REAL browser restart with `--restore-last-session`, then simulates the Chrome URL replacement and verifies the recovery function reverts it. |

---

## 6. SPLIT VIEW PROTECTION

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 6.1 | Tab in active Split View is NOT discarded | P0 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.2 | Split View ended → tab can be discarded | P1 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.3 | Chrome without `splitViewId` support → graceful fallback (no errors) | P2 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.4 | `splitViewId === -1` (not in split view) → tab discarded normally | P1 | Unit | ✅ | `SplitViewProtection.test.ts` |

---

## 7. BATTERY

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 7.1 | `autoSuspendOnlyOnBatteryOnly=true`, charging → no suspension | P1 | Unit | ✅ | `TabObserver.Battery.test.ts` |
| 7.2 | `autoSuspendOnlyOnBatteryOnly=true`, on battery → suspension works | P1 | Unit | ✅ | `TabObserver.Battery.test.ts` |
| 7.3 | Battery level above threshold → no suspension | P2 | Unit | ✅ | `TabObserver.Battery.test.ts` |
| 7.4 | Battery level below threshold → suspension works | P2 | Unit | ✅ | `TabObserver.Battery.test.ts` |
| 7.5 | Battery API unavailable → feature gracefully disabled, no crash | P3 | Unit | ✅ | `OffscreenDocument.Heartbeat.test.ts` |

---

## 8. AUTO-CLOSE TABS

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 8.1 | Total tabs > limit → lowest-rank tab (min rank formula) is closed | P1 | Unit | ✅ | `TabObserver.AutoClose.test.ts` |
| 8.2 | Grouped tab with `ignoreCloseGroupedTabs=true` → not closed | P2 | Unit | ✅ | `TabObserver.AutoClose.test.ts` |
| 8.3 | Rank calculated correctly (formula: `active_time² × (swch+1) - time×k`) | P2 | Unit | ✅ | `TabObserver.AutoClose.test.ts` |
| 8.4 | Closed tab added to closeHistory (LIFO, capped at 300) | P2 | Unit | ✅ | `TabParkController.History.test.ts` |
| 8.5 | Total tabs ≤ limit → no tab is closed | P1 | Unit | ✅ | `TabObserver.AutoClose.test.ts` |

---

## 9. DISCARDING

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 9.1 | `discardTabAfterSuspendWithTimeout=true` → suspended tab auto-discarded after `timeout×factor` | P1 | Unit | ✅ | `TabObserver.Discard.test.ts` |
| 9.2 | Tab marked for restore → discard is skipped | P1 | Unit | ✅ | `TabObserver.Discard.test.ts` |
| 9.3 | `openUnfocusedTabDiscarded=true` → new background tab discarded immediately | P2 | E2E | ✅ | `unfocused-tab-discard.test.ts` |
| 9.4 | Already discarded tab on activation — correct navigation to park.html | P1 | E2E | ✅ | `discard-tab-id-change.test.ts` |

---

## 10. CTRL+CLICK SUSPENSION

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 10.1 | `suspendOnCtrlClick=true`, Ctrl+Click on link → new tab suspended immediately | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |
| 10.2 | `nextTabShouldBeSuspended` flag reset after 3 s if tab never opened | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |
| 10.3 | No screenshot captured during Ctrl+Click suspension | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |

---

## 11. SETTINGS

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 11.1 | Export settings to JSON → correct format | P1 | Unit | ✅ | `SettingsExportImport.test.ts` |
| 11.2 | Import settings from JSON → all fields applied | P1 | Unit | ✅ | `SettingsExportImport.test.ts` |
| 11.3 | SettingsStore resilient to chrome.storage corruption | P1 | Unit | ✅ | `SettingsStore.Resilience.test.ts` |
| 11.4 | Timeout changed → TabObserver applies new value immediately | P1 | Unit | ✅ | `TabObserver.SettingsChange.test.ts` |
| 11.5 | Background color validation: valid hex / invalid hex | P2 | Unit | ❌ | `getParkBgColor` is a closure in `background.ts` — not unit-testable without heavy background-script side effects |
| 11.6 | Reset settings to default values | P2 | Unit | ❌ | `resetToDefaults` function is not implemented in the codebase |
| 11.7 | Export/import roundtrip without data loss | P1 | Unit | ✅ | `BGMessageListener.ExportImport.test.ts` |

---

## 12. STORAGE AND DATABASE

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 12.1 | IndexedDB initializes correctly, retry on error | P1 | Unit | ✅ | `IndexedDBProvider.test.ts` |
| 12.2 | Screenshot saved and read without loss | P1 | Unit | ✅ | `ScreenshotController.test.ts` |
| 12.3 | DBCleanup removes stale records (> 24 h) | P2 | Unit | ✅ | `DBCleanup.test.ts` |
| 12.4 | Corrupt chrome.storage → extension starts without crash | P0 | E2E | ✅ | `corrupt-storage.test.ts` |
| 12.5 | `arrayBufferToBase64` / `base64ToArrayBuffer` roundtrip lossless for data > 8 KB (chunked path) | P2 | Unit | ✅ | `TabManager.test.ts` |
| 12.6 | `PageStateRestoreController.cleanup()` removes entries older than 7 s; 60 s interval fires with correct `this` binding | P2 | Unit | ✅ | `PageStateRestoreController.Cleanup.test.ts` |
| 12.7 | Suspension history capped at 300 entries (LIFO) | P3 | Unit | ✅ | `TabParkController.History.test.ts` |

---

## 13. TAB MANAGER AND ID REPLACEMENT

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 13.1 | Find TabInfo by replaced tab ID (onReplaced event) | P1 | Unit | ✅ | `TabManager.test.ts` |
| 13.2 | ID replacement chain tracked correctly | P2 | Unit | ✅ | `TabManager.test.ts` |
| 13.3 | Integration: TabManager + suspension + ID replacement | P1 | Unit | ✅ | `TabManagerIntegration.test.ts` |
| 13.4 | Discard changes tab ID → data preserved, restore works | P1 | E2E | ✅ | `discard-tab-id-change.test.ts` |

---

## 14. SCREEN CAPTURE (TabCapture)

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 14.1 | Capture executes when tab activates (`status === 'complete'`) | P1 | Unit | ✅ | `TabCapture.test.ts` |
| 14.2 | MAX_CAPTURE quota error → graceful rejection, no crash | P2 | Unit | ✅ | `TabCapture.test.ts` |
| 14.3 | chrome:// page → error caught, suspension not broken | P2 | Unit | ✅ | `TabCapture.test.ts` |
| 14.4 | Tab closed during capture → no unhandled exception | P2 | Unit | ✅ | `TabCapture.test.ts` |

---

## 15. BROWSER START AND SESSION

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 15.1 | `restoreTabOnStartup=true` → suspended tabs restored on startup | P1 | E2E | ❌ | Feature not implemented in extension (code is commented out) |
| 15.2 | `startDiscarted=true` → suspended tabs immediately discarded on start | P2 | E2E | ✅ | `start-discarded.test.ts` |
| 15.3 | Session ID saved and read after browser restart | P2 | Unit | ❌ | `TSSessionId` is a `const` evaluated at `background.ts` load time — not unit-testable |
| 15.4 | Grouped tabs restored before session processing | P2 | Unit | ✅ | `GroupRestoreFix.test.ts` |

---

## 16. HEARTBEAT AND SERVICE WORKER

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 16.1 | Offscreen document sends heartbeat every 20 s | P2 | Unit | ✅ | `OffscreenDocument.Heartbeat.test.ts` |
| 16.2 | Service worker does not sleep during active use | P2 | E2E | ✅ | `service-worker-alive.test.ts` |

---

## 17. KEYBOARD COMMANDS AND CONTEXT MENU

| # | Test Case | Priority | Type | Status | Note |
|---|-----------|----------|------|--------|------|
| 17.1 | "Suspend Current Tab" suspends the active tab | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase C |
| 17.2 | "Suspend All Other Tabs" suspends all except current | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase A |
| 17.3 | "Unsuspend Current Window" restores all tabs in window | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase B |
| 17.4 | "Add to Whitelist" from menu saves pattern and syncs icon | P2 | E2E | ✅ | `whitelist-ignore.test.ts` (underlying API) |
| 17.5 | Extension icon changes: normal / off / paused / whitelisted / ignored | P2 | E2E | ✅ | `extension-icon.test.ts` |

---

## SUMMARY STATISTICS

| Priority | Total | Covered ✅ | Partial ⚠️ | Not covered ❌ |
|----------|-------|-----------|-----------|---------------|
| P0 (critical) | 13 | 13 | 0 | 0 |
| P1 (high) | 47 | 46 | 0 | 1 |
| P2 (medium) | 41 | 38 | 1 | 2 |
| P3 (low) | 3 | 3 | 0 | 0 |
| **Total** | **104** | **100 (96%)** | **1 (1%)** | **3 (3%)** |

Remaining ❌ cases cannot be covered for the following reasons:
- **11.5, 15.3** — logic lives inside `background.ts` which cannot be safely `require()`d in unit tests due to immediate side effects at load time (`chrome.runtime.getURL`, `new OffscreenDocumentProvider()`, etc.)
- **11.6** — `resetToDefaults` function is not implemented anywhere in the codebase
- **15.1** — feature code is commented out in the extension and does not execute

---

## Puppeteer tests (files)

| File | Covers | Status |
|------|--------|--------|
| `basic-suspend-restore.test.ts` | 1.1, 2.1 | ✅ |
| `auto-restore-tab.test.ts` | 2.2 | ✅ |
| `restore-modes.test.ts` | 2.3, 2.4 | ✅ |
| `form-data-restore.test.ts` | 2.8 | ✅ |
| `protected-urls.test.ts` | 3.8 | ✅ |
| `whitelist-ignore.test.ts` | 3.4, 3.5, 3.9, 17.4 | ✅ |
| `favicon-loss.test.ts` | 4.1, 4.2, 4.3 | ✅ |
| `favicon-nav-stress.test.ts` | 4.4 | ✅ |
| `screenshot-settings.test.ts` | 4.5, 4.6 | ✅ |
| `discard-tab-id-change.test.ts` | 9.4, 13.4 | ✅ |
| `unfocused-tab-discard.test.ts` | 9.3 | ✅ |
| `corrupt-storage.test.ts` | 12.4 | ✅ |
| `start-discarded.test.ts` | 15.2 | ✅ |
| `bulk-tab-operations.test.ts` | 17.1, 17.2, 17.3 | ✅ |
| `adaptive-timeout.test.ts` | 1.8 | ✅ |
| `pinned-tab-protection.test.ts` | 5.1, 5.2 | ✅ |
| `hover-restore.test.ts` | 2.6 | ✅ |
| `url-param-preserve.test.ts` | 2.9 | ✅ |
| `service-worker-alive.test.ts` | 16.2 | ✅ |
| `extension-icon.test.ts` | 17.5 | ✅ |
| `tab-group-session-restore.test.ts` | 5.10 | ✅ |
| `tab-group-session-restore-collapsed.test.ts` | 5.10 (collapsed groups variant) | ✅ |
| `tab-group-session-restore-autorestore.test.ts` | 5.10 (autoRestoreTab/reloadTabOnRestore variant) | ✅ |
| `tab-group-session-restore-race.test.ts` | 5.10 (activation race probe) | ✅ |

## Jest unit tests (files)

| File | Covers | Status |
|------|--------|--------|
| `CtrlClickSuspend.test.ts` | 10.1, 10.2, 10.3, 4.10 | ✅ |
| `TabCapture.test.ts` | 14.1, 14.2, 14.3, 14.4, 4.11 | ✅ |
| `TabObserver.AutoSuspension.test.ts` | 1.2, 1.3, 1.4, 1.6, 1.7, 1.9, 1.10 | ✅ |
| `TabObserver.Battery.test.ts` | 7.1, 7.2, 7.3, 7.4 | ✅ |
| `TabObserver.ActiveDisabled.test.ts` | 1.5 | ✅ |
| `TabObserver.ActiveTabAudible.test.ts` | 5.3, 5.4 | ✅ |
| `TabObserver.AutoClose.test.ts` | 8.1, 8.2, 8.3, 8.5 | ✅ |
| `TabObserver.Discard.test.ts` | 9.1, 9.2 | ✅ |
| `TabObserver.FaviconRetry.test.ts` | 4.9 | ✅ |
| `TabObserver.SettingsChange.test.ts` | 11.4 | ✅ |
| `WhiteList.test.ts` | 3.1, 3.2, 3.3, 3.6, 3.7 | ✅ |
| `GroupRestoreFix.test.ts` | 15.4 | ✅ |
| `SettingsExportImport.test.ts` | 11.2 | ✅ |
| `SettingsStore.Resilience.test.ts` | 11.3 | ✅ |
| `BGMessageListener.ExportImport.test.ts` | 11.7 | ✅ |
| `TabRestore.test.ts` | 2.5, 2.7 | ✅ |
| `OffscreenDocument.Heartbeat.test.ts` | 16.1, 7.5 | ✅ |
| `TabParkController.History.test.ts` | 8.4, 12.7 | ✅ |
| `PageStateRestoreController.Cleanup.test.ts` | 12.6 | ✅ |
| `TabManager.test.ts` | 13.1, 13.2, 12.5 | ✅ |
