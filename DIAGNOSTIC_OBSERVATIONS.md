# Issue #4 — Diagnostic observations and reproduction status

> Created: 2026-06-16
> Goal: collect all findings before attempting any core-code fix.

## Current state

We are investigating why collapsed/expanded grouped tabs that were parked by Tab Suspender become blank/new-tab pages after Chrome session restore.

## What we reproduced synthetically

- `test/puppeteer/tab-group-session-restore-corrupted-url.test.ts` — manually replaces the `url=` query parameter of grouped parked tabs with `about:blank`. After restore, activating those tabs produces a blank page; pressing Back returns to `park.html`. This matches the user's symptom exactly.
- The vulnerable code path is confirmed in `park.ts` `goBack()` and `TabManager.unsuspendTab()` — both read `url=` from the park URL and navigate to it without validation.

## Hypotheses tested and results

| # | Hypothesis | Test file | Result |
|---|------------|-----------|--------|
| 1 | Discarding grouped tabs before parking corrupts the URL | `tab-group-discard-before-suspend.test.ts` | FAILED to reproduce — all URLs stayed valid |
| 2 | Activate-then-discard cycle corrupts state | `tab-group-session-restore-activate-discard-cycle.test.ts` | FAILED to reproduce — 15/0 passed |
| 3 | Missing `tabInfos` snapshot + double cycle | `tab-group-session-restore-double-cycle.test.ts` | FAILED to reproduce — reconstruction from park URL works |
| 4 | Heavy load + CPU throttling | `tab-group-session-restore-heavy.test.ts` | FAILED to reproduce — 11/0 passed |
| 5 | True SIGKILL abrupt kill | `tab-group-session-restore-abrupt-sigkill.test.ts` | Chrome restores 0 tabs in Puppeteer; not usable |
| 6 | Chrome session file corruption propagates | `tab-group-session-restore-corrupt-session-file.test.ts` | Chrome restores real URLs, not the corrupted park URL |
| 7 | Other extensions interfere (AdBlock Plus + Awesome Screenshot) | `tab-group-session-restore-with-extensions.test.ts` | FAILED to reproduce — 10/0 passed |
| 8 | Expanded groups + simulated Chrome update relaunch | `tab-group-session-restore-chrome-update.test.ts` | FAILED to reproduce — 11/0 passed |

## New critical observation (2026-06-16)

After adding diagnostic logging only, the existing `tab-group-session-restore.test.ts` now fails intermittently with:

```
all restored grouped tabs have non-null parkedUrl in TabInfo (null count=N, ids=[...])
```

The failure happens because some restored grouped tabs end up with `TabInfo.parkedUrl === null` while `parked === true`. The failure count varies between runs (8, 11, 30 tabs out of 30). The affected tabs appear consecutively in the snapshot, which strongly suggests a race condition.

### Key details from the failure snapshot

- The affected tabs have `oldRefParkedUrl: null` and `originRefId` equal to the pre-restart tab ID.
- The park URL in `tab.url` still contains the correct `url=https://example.com/...` query parameter.
- So `park.html` itself is not corrupted; the corruption/lost state is inside `TabInfo` in the service worker.

### Experiment: loadTabInfos preserve block

The block at `modules/TabManager.ts:129-142` that tries to preserve in-memory `parkedUrl` over a stale persisted snapshot was **commented out** by the user for a clean experiment. The observation still reproduced: some restored grouped tabs ended up with `parkedUrl=null`. This means the block is neither the sole cause of the bug nor a complete fix.

### Likely mechanism (refined after capturing full SW startup logs)

The improved CDP log capture was attached immediately after browser relaunch. Two back-to-back runs of `tab-group-session-restore.test.ts` produced:

- **Run 1 (pass):** all 30 grouped tabs were `discarded: true` before the browser closed. After restore, every grouped TabInfo had a valid `parkedUrl`.
- **Run 2 (fail):** the same grouped tabs were `parked: true` but `discarded: false` before close. After restore, **all 30** restored grouped tabs had `parkedUrl === null`.

The service-worker logs from the failing run show the exact chain:

```
[TabManager.getTabInfoOrCreate] Found parked[20291353] Tab[20291657] (groupId=325324774) without TabInfo. Reconstructing from park url param url=https://example.com/?group=1&tab=1
[TabManager.onTabReplaceDetected] 20291353 -> 20291657. removed.parked=false, removed.parkedUrl=null
```

This means:

1. `park.html` still carries the correct `url=` parameter, so reconstruction produces the right `parkedUrl`.
2. However, `tabInfos[20291353]` **already exists** from the persisted `chrome.storage.local` snapshot, and it was saved with `parked=false, parkedUrl=null`.
3. Because the old entry exists, `getTabInfoOrCreate()` skips creating a fresh reconstructed TabInfo and calls `onTabReplaceDetected(20291657, 20291353)`.
4. `onTabReplaceDetected()` copies the **stale old object** to the new tab ID, including the null `parkedUrl`.

In the passing run the same old entries had `parked=true, parkedUrl=<real URL>` (the grouped tabs were discarded before close, which apparently allowed the persisted snapshot to catch the correct value).

**Root cause:** `TabManager.getTabInfoOrCreate()` treats a persisted `TabInfo` with a null/invalid `parkedUrl` as authoritative, even though the live `park.html` URL contains the correct original URL. A stale snapshot saved before `markTabParked()` completed (or before the 10-second `storeTabInfos()` loop ran) overrules the live reconstruction during session restore.

The previously commented-out `loadTabInfos()` preservation block is **not the cause and not a sufficient fix** for this path: it only preserves in-memory state when the loaded snapshot has `parked=false`, but here the issue is a stale old entry that is reused directly by `onTabReplaceDetected()`.

## Why this explains the user's symptom

When `TabInfo.parkedUrl` is `null` but the tab is still on `park.html?url=REAL_URL`:

- The visible tooltip still shows the extension URL (`park.html`), matching the user's observation.
- On some later event (possibly a second session restore, a Chrome update, or a tab discard/activate cycle) the park page may be re-processed. If `park.html` is then re-parked or reconstructed using the now-null `parkedUrl`, the `url=` query parameter can become `about:blank`.
- Activating the tab then navigates to `about:blank`, producing the blank page.

## Probable fixes to evaluate later

When core-code fixes are allowed, evaluate these targeted changes in `modules/TabManager.ts`:

1. **Make `getTabInfoOrCreate()` repair a stale old `TabInfo` before reusing it**
   - When a parked tab is reconstructed and `tabInfos[removedTabId]` already exists with `parkedUrl == null`/invalid while the live park URL has a valid `url=` parameter, update the old entry's `parkedUrl` before calling `onTabReplaceDetected()`.
   - This directly fixes the observed root cause: the live `park.html` URL becomes the authoritative source for `parkedUrl` when the persisted snapshot is incomplete.

2. **Make `onTabReplaceDetected()` not copy a null/invalid `parkedUrl` to the new tab ID**
   - If the old `TabInfo` has `parkedUrl == null` but the new tab's `park.html` URL contains a valid `url=`, use the URL from the live page instead of blindly copying the stale value.

3. **Reconstruct `parkedUrl` from `tab.url` whenever a parked tab is confirmed in `onUpdated()`**
   - Keep the existing guard that avoids flipping `parked=false` on transient `about:blank`, but also refresh `tabInfo.parkedUrl` from the live park URL when it is null/invalid.

4. **Defensive validation in `park.ts goBack()` and `TabManager.unsuspendTab()`**
   - If `url=` query parameter is blank/new-tab, fall back to `parkedUrl` from `TabInfo` before navigating.
   - This does not fix the root cause but prevents the blank-tab symptom if the park URL ever becomes corrupted.

## What is needed next

The root cause is now a confirmed code-level bug in `TabManager.getTabInfoOrCreate()` / `onTabReplaceDetected()`: a stale persisted `TabInfo` with `parkedUrl=null` overrides the correct live reconstruction from `park.html`. The next step is to implement one of the fixes above and rerun the failing E2E test until it passes consistently.

Real-user diagnostic logs should be checked for the same pattern: `[TabManager.onTabReplaceDetected] ... removed.parked=false, removed.parkedUrl=null` for grouped tabs that were parked but not yet discarded before the browser was closed.

## Files touched for diagnostic logging only

- `modules/TabManager.ts` — logs for `loadTabInfos`, `onUpdated`, `onTabReplaceDetected`, `unsuspendTab`, `getTabInfoOrCreate`, `markTabParked`
- `modules/TabParkController.ts` — logs for `parkTab`, final grouped park URL
- `modules/BGMessageListener.ts` — log for `[TS:dataForParkPage]`
- `park.ts` — log for `goBack`
- `background.ts` — log for post-restore grouped tab discard
- `test/puppeteer/base/ExtensionHelper.ts` — improved service-worker target selection when multiple extensions are loaded; added target-aware CDP console capture that follows service-worker restarts
- `test/puppeteer/tab-group-session-restore.test.ts` — moved `installSWLogCapture()` to immediately after relaunch so startup logs are captured

## New test files added

- `tab-group-session-restore-with-extensions.test.ts`
- `tab-group-session-restore-chrome-update.test.ts`
- `tab-group-session-restore-corrupt-session-file.test.ts`

## Real-Chrome confirmation of the full causal chain (2026-06-16)

The same pattern was reproduced in the user's live Chrome profile:

1. Grouped parked tabs underwent **double tab-ID replacement** during session restore, e.g. `1256163892 -> 1256163996 -> 1256164122`.
2. `onTabReplaceDetected` copied `removed.parkedUrl=null` to each new tab ID, so the final live tab ID carried a null `parkedUrl`.
3. `BGMessageListener.dataForParkPage` returned `foundTabInfo=false, parkedUrl=undefined` for the original/old tab IDs and threw `Cannot read properties of undefined (reading 'toObject')`.
4. The final log entries corresponded to **activating** the restored grouped tab, which then navigated to `chrome://newtab/` instead of the original page.

This confirms that the `parkedUrl=null` race is not a synthetic Puppeteer artifact — it is the same root cause behind the real user symptom.

## Proposed fix plan (pending — do not implement yet)

The root cause (`parkedUrl=null` in TabInfo after session restore) is now confirmed in both Puppeteer and real Chrome, but a **native Puppeteer reproduction of the final blank/new-tab symptom has not yet been achieved**. The fix plan is intentionally kept in diagnostic notes only; core-code changes are on hold until we can reproduce the full causal chain in Puppeteer without artificial URL substitution.

### Candidate changes when approved

1. `modules/TabManager.ts` — `getTabInfoOrCreate()`
   - When a parked tab is reconstructed from `park.html?url=...` and `tabInfos[oldTabId]` already exists with an invalid/empty `parkedUrl`, repair the stale entry before calling `onTabReplaceDetected()`.
   - Treat `about:blank`, `about:newtab`, `chrome://newtab/`, empty string, and `null` as invalid `parkedUrl` values.

2. `modules/TabManager.ts` — `onTabReplaceDetected()`
   - Do not copy a null/invalid `parkedUrl` from the removed tab to the new tab when the new tab's live `park.html` URL contains a valid `url=` parameter.

3. `modules/BGMessageListener.ts` — `[TS:dataForParkPage]`
   - Guard against `findReplacedTabById()` returning `undefined`: return `parkedUrl: tabInfo?.parkedUrl ?? null` and `tabInfo: tabInfo?.toObject?.() ?? null`, avoiding `Cannot read properties of undefined (reading 'toObject')`.

4. Defensive validation in `park.ts goBack()` and `TabManager.unsuspendTab()`
   - If `url=` query parameter is blank/new-tab, fall back to `parkedUrl` from `TabInfo` before navigating; if no valid fallback exists, abort navigation and log the incident.

### Pending work before implementation

- Reproduce the **final blank/new-tab symptom natively in Puppeteer** (without manually corrupting the `url=` parameter):
  - SIGKILL grouped parked tabs that are **not yet discarded** before kill.
  - After restore, verify `parkedUrl=null` in TabInfo.
  - Let Chrome discard the restored grouped tabs (or force discard).
  - Activate the discarded tab so Chrome reloads it and Tab Suspender re-parks it.
  - Confirm that the re-parked `url=` becomes `about:blank` / `chrome://newtab/` and activation navigates to a blank/new-tab page.
- Only after this native reproduction passes should the candidate changes above be implemented and verified.

## Note

No core-code fixes have been applied yet. All changes in `modules/TabManager.ts`, `modules/BGMessageListener.ts`, and `park.ts` that were not pure diagnostic logging must be rolled back so that investigation can continue against the original buggy code.
