# Issue #4 — Root cause chain (confirmed in real Chrome)

> Date: 2026-06-16  
> Source: manual console analysis of a live broken Chrome profile with 5 grouped tabs in the erroneous pre-activation state.

## Final causal chain

### 1. Grouped tabs are restored with tab-ID replacement

Chrome session restore reassigns tab IDs. For tabs inside (especially collapsed) groups the reassignment is more complex and the final live tab ID differs from the original ID stored in `park.html?tabId=...`.

Two observed patterns from real Chrome:

- **Double replacement (older sessions):**
  - `originId = 1256153919` → `intermediateId = 1256164017` → `liveId = 1256164137`
  - Here `tabInfos[originId]` is missing after restore; the chain cannot be walked at all.

- **Single replacement with a lost origin link (recent sessions):**
  - `originId = 1256162688` → `intermediateId = 1256163297` → `liveId = 1256164155`
  - `tabInfos[originId]` exists and has a valid `parkedUrl`, but `tabInfos[intermediateId]` is `closed` and has lost the class methods (`toObject is undefined`).

In both cases `tabInfos[liveId]` exists, `_parked=true`, but `_parkedUrl=null` and `_originRefId=undefined`.

### 2. `onTabReplaceDetected` leaves a stale / plain-object `TabInfo`

`TabManager.onTabReplaceDetected(addedTabId, removedTabId)`:

1. Copies `tabInfos[removedTabId]` into `tabInfos[liveId]`.
2. Replaces `tabInfos[removedTabId]` with `structuredClone(this.tabInfos[removedTabId])`.
3. Calls `markTabClosed(removedTabId)`.

`structuredClone` turns a `TabInfo` class instance into a **plain object**, stripping getters/setters and the `toObject()` method. The intermediate entry therefore keeps `_parkedUrl: null`/`undefined` and loses all class behaviour.

### 3. `[TS:dataForParkPage]` fails to return a valid fallback

When `park.ts` loads, it sends `tabId = originId` (read from `park.html?tabId=...`):

1. `findReplacedTabById(originId)` calls `findReplacedTabId(originId)`.
2. `findReplacedTabId` walks the `newRefId` chain.
3. Depending on the session, the chain either:
   - ends at a missing `tabInfos[originId]` (returns `undefined`), or
   - reaches a closed intermediate plain object without `toObject()`.
4. `BGMessageListener` immediately calls `.toObject()` on the result:
   ```ts
   tabInfo: tabManager.findReplacedTabById(request.tabId).toObject(),
   ```
5. This throws (`Cannot read properties of undefined (reading 'toObject')`).
6. The `catch` block returns `{}` to `park.ts`.

### 4. The tab navigates to a blank/new-tab page

`park.ts` receives `parkData = {}`, so:

- `parkedUrl` is undefined.
- `goBack()` / `continueStart()` cannot fall back to a stored original URL.
- Chrome activates the discarded grouped tab and sets `pendingUrl: "chrome://newtab/"`.
- The tab navigates to `chrome://newtab/` / `about:blank`.

## Upstream Chromium architectural bug

Independent research confirmed a Chrome-level race that explains why grouped tabs are hit hardest:

1. **Extension URL replacement.** To suspend a tab, the extension replaces its active URL with an internal `chrome-extension://...` URL (`park.html?url=REAL_URL`).
2. **Session Restore security check.** When Chrome restarts/crashes, the built-in Session Restore engine scans saved tab groups and reads the saved URL string. Instead of a normal `https://` protocol it sees `chrome-extension://`.
3. **Strict security sandbox.** Chromium does not let extensions initialize or execute scripts until the browser architecture is fully active and authenticated. At the millisecond Session Restore runs, the extension is not yet booted, so Chrome's security manager flags the `chrome-extension://` origin as unauthenticated/untrusted.
4. **Fallback to `about:blank`.** When Chrome blocks an internal page load during session restoration, its native default fallback is to discard the URL and render `about:blank` or a New Tab. This is an upstream Chrome architectural bug.

### Why grouped tabs are affected first

Tab groups (especially collapsed ones) are restored earlier and through a placeholder mechanism. The grouped placeholder is created before the extension is authenticated, so its `chrome-extension://` URL is blocked and replaced with `about:blank` / `chrome://newtab/`. Ungrouped tabs are restored later or through a simpler path, giving the extension time to authenticate, so they more often keep the original `park.html` URL.

### Interaction with our state corruption

The upstream bug can manifest in two ways:

- **Full upstream race:** Chrome replaces `park.html` with `about:blank` *before* the extension loads. In this case `tab.url` is already blank and the original URL must be recovered entirely from `TabInfo` or the `park.html` query string (if the tab was later redirected back to park).
- **Partial race (observed in the live profile):** Chrome keeps `tab.url` on `park.html?url=REAL_URL`, but the double tab-ID replacement plus `structuredClone` corrupts `TabInfo.parkedUrl` and removes `originRefId`. When the user later activates the discarded grouped tab, `BGMessageListener.dataForParkPage` throws, `park.ts` has no fallback, and Chrome's discarded-tab reload falls back to `chrome://newtab/`.

Either way, the extension must defend at both levels.

## Live-data summary

From the broken profile (50 tabs total):

| Category | Count | `parkedUrl=null` | Notes |
|---|---|---|---|
| Grouped parked | 9 | 8/9 | Broken tabs have `oldRefId` but `originRefId=undefined`. |
| Ungrouped parked | 14 | 6/14 | Even with `parkedUrl=null`, these do not go blank on activation. |
| Ungrouped normal | 27 | — | Not relevant. |

### Grouped broken tab example

| Field | Value |
|---|---|
| `tab.url` | `chrome-extension://.../park.html?tabId=1256153919&url=https://grafana...` |
| `tab.title` | `ALL - OVERVIEW - Unix - Dashboards - Grafana` |
| `tab.discarded` | `true` |
| `tabManager.tabInfos[1256164137]._parked` | `true` |
| `tabManager.tabInfos[1256164137]._parkedUrl` | `null` |
| `tabManager.tabInfos[1256164137]._oldRefId` | `1256164017` |
| `tabManager.tabInfos[1256164137]._originRefId` | `undefined` |
| `tabManager.tabInfos[1256164017]._closed` | `{ at: 1781617376767, tsSessionId: 1781617368390 }` |
| `tabManager.tabInfos[1256164017]._parkedUrl` | `null` |
| `tabManager.tabInfos[1256164017].toObject` | `undefined` (plain object) |
| `findReplacedTabById(1256153919)` | returns `undefined` or a plain object; `.toObject()` throws |

### Grouped healthy tab example

| Field | Value |
|---|---|
| `tab.url` | `chrome-extension://.../park.html?tabId=1256164128&url=https://grafana...` |
| `tabManager.tabInfos[1256164270]._parkedUrl` | `https://grafana.nlmk.com/login` |
| `tabManager.tabInfos[1256164270]._oldRefId` | `1256164128` |
| `tabManager.tabInfos[1256164270]._originRefId` | `1256164128` |

Healthy grouped tab has no double replacement — `oldRefId` equals the origin.

## Why the bug happens only for grouped tabs

1. **Grouped (especially collapsed) tabs are restored via a placeholder.** Chrome restores a collapsed group by first creating a lightweight placeholder tab (`about:blank` or `chrome://newtab/`) and then replacing it with the real content. This replacement changes the tab ID and severs the link between the live tab and the origin ID stored in `park.html?tabId=...`.

2. **Ungrouped tabs keep the same ID chain.** Even when `parkedUrl` is stale, ungrouped tabs retain `oldRefId === originId`, so `findReplacedTabById(originId)` still finds the live `TabInfo` and activation can fall back to `parkedUrl` or to the `url=` query parameter.

3. **Grouped broken tabs lose `originRefId`.** Because the final `TabInfo` has `originRefId=undefined`, `BGMessageListener` cannot resolve the live entry when asked for the origin `tabId`, and `park.ts` receives an empty response.

## Why manually redirecting back to `park.html` works

The user manually updated the broken tab back to the same `park.html?url=REAL_URL` URL. After that, click/hover restored the original page because `park.ts goBack()` reads `searchParams.get('url')`, which is still valid. This confirms that **the `park.html` URL itself is not corrupted**; the bug is purely in the stale `TabInfo` state.

## Fix strategy: two-level defense

### Level 1 — Prevent the corrupt `TabInfo` end-state

1. **`modules/TabManager.ts` — `onTabReplaceDetected()`**
   - Do not copy a null/invalid `parkedUrl` from the removed tab to the new tab when the new tab's live `park.html` URL contains a valid `url=` parameter.
   - Replace `structuredClone` on `TabInfo` with a class-preserving copy (e.g. `TabInfo.fromObject(tabInfo.toObject())`), so the intermediate entry keeps `toObject()` and other methods.
   - Preserve / restore `originRefId` so the live `TabInfo` always points back to the original ID stored in `park.html`.

2. **`modules/TabManager.ts` — `getTabInfoOrCreate()`**
   - When a parked tab is reconstructed from `park.html?url=...` and `tabInfos[oldTabId]` already exists with an invalid/empty `parkedUrl`, repair the stale entry before calling `onTabReplaceDetected()`.
   - Treat `about:blank`, `about:newtab`, `chrome://newtab/`, empty string, and `null` as invalid `parkedUrl` values.
   - If `tab.url` contains a valid `url=` parameter, set `tabInfos[oldTabId].parkedUrl = validUrl`.

### Level 2 — Recover gracefully when Chrome already blanked the URL

3. **`modules/BGMessageListener.ts` — `[TS:dataForParkPage]`**
   - Guard against `findReplacedTabById()` returning a plain object or `undefined`:
     ```ts
     const tabInfo = tabManager.findReplacedTabById(request.tabId);
     const tabInfoObject = typeof tabInfo?.toObject === 'function' ? tabInfo.toObject() : (tabInfo ?? null);
     ```
   - Return `parkedUrl: tabInfo?.parkedUrl ?? null` and `tabInfo: tabInfoObject`.
   - If `parkedUrl` is still invalid, fall back to the live `park.html?url=...` query parameter parsed from the tab URL.

4. **`park.ts` — `goBack()` and `TabManager.ts` — `unsuspendTab()`**
   - Validate `targetUrl` from `searchParams.get('url')` before navigating.
   - If invalid, fall back in order to:
     1. `globalParkData.parkedUrl` (persisted `TabInfo.parkedUrl`).
     2. `globalParkData.tabInfo?.lstCapUrl` (last captured URL).
   - If no valid URL remains, log an error and abort navigation instead of going to `about:blank` / `chrome://newtab/`.

5. **Startup recovery in `TabManager.ts` / `background.ts`**
   - On Service Worker startup, scan all tabs.
   - If a tab is in a group, its URL is `about:blank` / `chrome://newtab/` / `about:newtab`, and `tabInfos[id]` indicates it is parked, redirect the tab back to a valid `park.html?url=...` or directly to the original URL.

## Regression-test strategy

A native Puppeteer reproduction of the full Chrome session-restore race is hard to trigger. The recommended regression test should:

1. Open a grouped tab and park it.
2. Through the Service Worker, construct the exact broken end-state:
   - live tab URL is `park.html?tabId=originId&url=REAL_URL`;
   - `tabInfos[liveId]` exists with `_parked=true`, `_parkedUrl=null`, `_originRefId=undefined`;
   - `tabInfos[originId]` is either missing or a plain closed object.
3. Discard the live tab and activate it.
4. Assert the tab does **not** navigate to `about:blank` or `chrome://newtab/`.
5. After the fix, the tab should restore the original URL from the `park.html` query parameter.

**Target regression test file:** `test/puppeteer/tab-group-blank-endstate-regression.test.ts`
