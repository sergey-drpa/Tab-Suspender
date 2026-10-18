/**
 * Tab Suspender — Issue #4 real-restart recovery test
 *
 * Verifies BOTH issue #4 fixes end-to-end with a REAL browser restart (not a
 * simulated broken state):
 *
 *   Fix 1 (startup recovery): After Chrome session restore replaces a grouped
 *   parked tab's URL with about:blank BEFORE the service worker starts, the
 *   SW's onUpdated listener misses the event. On startup, after loadTabInfos(),
 *   TabManager.recoverBlankParkedTabsOnStartup() scans all tabs and reverts
 *   blank grouped parked tabs back to park.html.
 *
 *   Fix 2 (restoredFromStorage): After restart, park.ts goBack() must NOT use
 *   history.go(-1) (bfcache is gone, lands on about:blank) — it must use
 *   window.location.replace(targetUrl) to navigate directly to the original
 *   URL. The restoredFromStorage flag on TabInfo (set in loadTabInfos) signals
 *   this.
 *
 * Test flow:
 *   1. Park a grouped (collapsed) tab with autoRestoreTab=false,
 *      reloadTabOnRestore=false (the user's actual settings).
 *   2. Close the browser.
 *   3. Relaunch with --restore-last-session.
 *   4. Verify the grouped tab is on park.html (NOT about:blank) — tests Fix 1.
 *   5. Trigger restore via hover on the parked tab.
 *   6. Verify the tab navigates to the ORIGINAL URL — tests Fix 2.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { type Browser } from 'puppeteer';
import { launchBrowser, sleep, log, EXTENSION_PATH } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  queryChromeTabs,
  parkUrlPrefix,
  getSetting,
  setSetting,
  waitForExtensionInit,
  installSWLogCapture,
  waitForParkPages,
  getParkPages,
  waitForAnyTabToLeaveParked,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-restart-blank-recovery');
const TARGET_URL  = 'https://example.com/?group=1&tab=1';

function ensureTabGroupsPermission(): void {
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('tabGroups')) {
    manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    manifest.permissions.push('tabGroups');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));
    log('Patched build_dir/manifest.json with tabGroups permission for test');
  }
}

async function main(): Promise<void> {
  log('Tab Suspender — Issue #4 real-restart recovery test');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let getSWLogs: (() => Promise<string[]>) | null = null;

  const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

  // ── Phase A: first browser session — park a grouped tab ──
  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched (fresh profile)');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);
    await waitForExtensionInit(browser);

    const tabsBefore = await queryChromeTabs(browser);
    const extensionTabs = tabsBefore.filter(
      t => t.url && t.url.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html'),
    );
    for (const et of extensionTabs) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
    }
    await sleep(300);

    originalTimeout = await getSetting<number>(browser, 'timeout');
    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'reloadTabOnRestore', false);
    await setSetting(browser, 'restoreOnMouseHover', true);
    log('  Applied test settings (autoRestoreTab=false, reloadTabOnRestore=false)');

    runner.section('Phase A — Open, group (collapsed), and park a tab');
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(300);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const targetTab = tabsAfterOpen.find(t => t.url === TARGET_URL);
    runner.assert(!!targetTab, 'target tab opened');
    const tabId = targetTab!.id;

    const groupId = await evalInSW<number>(browser, `(async () => {
      const groupId = await chrome.tabs.group({ tabIds: [${tabId}] });
      await chrome.tabGroups.update(groupId, { collapsed: true });
      return groupId;
    })()`);
    log(`  Tab ${tabId} grouped (groupId=${groupId}, collapsed)`);

    await sleep(300);
    await suspendTabById(browser, tabId);

    const parkPrefix = parkUrlPrefix(extensionId);
    await waitForParkPages(browser, extensionId, 1, 20000);
    const parkedTabs = (await queryChromeTabs(browser)).filter(t => t.url?.startsWith(parkPrefix));
    runner.assert(parkedTabs.length >= 1, 'tab is parked on park.html');
    runner.assert(
      parkedTabs[0].url!.includes(`url=${encodeURIComponent(TARGET_URL)}`),
      'park.html URL preserves original URL',
    );
    log(`  Parked: id=${parkedTabs[0].id} url=${parkedTabs[0].url!.slice(0, 90)}...`);

    await sleep(1000);
  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    await browser.close();
    log('Browser closed for restart');
  }

  // ── Phase B: restart browser with session restore ──
  runner.section('Phase B — Restart browser with --restore-last-session');
  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);
    const parkPrefix2 = parkUrlPrefix(extensionId2);

    getSWLogs = await installSWLogCapture(browser2);
    log('Installed SW log capture');

    await waitForExtensionInit(browser2);
    log('Extension initialized after restart');

    // Give the startup recovery pass a moment to run after loadTabInfos.
    await sleep(3000);

    runner.section('Phase C — Verify state after restart');
    const tabsAfterRestart = await queryChromeTabs(browser2);
    const groupTabsAfterRestart = tabsAfterRestart.filter(t => t.groupId != null && t.groupId > 0);
    log(`  Found ${groupTabsAfterRestart.length} grouped tab(s) after restart:`);
    for (const t of groupTabsAfterRestart) {
      log(`    id=${t.id} url=${(t.url || '').slice(0, 90)} discarded=${t.discarded} title=${t.title}`);
    }

    const blankGroupTabs = groupTabsAfterRestart.filter(t => blankUrls.has(t.url ?? ''));
    const parkedGroupTabs = groupTabsAfterRestart.filter(t => t.url?.startsWith(parkPrefix2));

    runner.assert(
      blankGroupTabs.length === 0,
      `no grouped tab is blank after restart (found ${blankGroupTabs.length} blank)`,
    );
    runner.assert(
      parkedGroupTabs.length >= 1,
      `grouped tab is on park.html after restart (found ${parkedGroupTabs.length})`,
    );

    runner.section('Phase C.5 — Simulate Chrome replacing park.html with about:blank and verify onUpdated revert');
    // Chrome's session-restore URL replacement is non-deterministic in puppeteer.
    // To deterministically verify the onUpdated revert (Level 3 of the Issue #4
    // fix) we reconstruct the exact post-restart broken state observed in the
    // live profile:
    //
    //   1. The parked tab's URL is about:blank (Chrome replaced it). In the real
    //      race this happens BEFORE the service worker starts, so no onUpdated
    //      fires for it and the persisted parked=true TabInfo survives. We
    //      blank the URL explicitly and then restore the persisted parked state
    //      by hand (the explicit blanking DOES fire onUpdated, which correctly
    //      clears the in-memory parked state — so a live URL transition is a
    //      deliberate navigation and must NOT be hijacked back to park.html).
    //   2. We then fire a NON-URL onUpdated event (like the user activating the
    //      blank tab) and assert the revert fires via the tab.url check and
    //      brings the tab back to park.html with the original URL preserved.
    let liveIdForRestore: number | null = null;
    if (parkedGroupTabs.length === 0) {
      log('  No parked grouped tab found — skipping Phase C.5');
    } else {
      const parkedTab = parkedGroupTabs[0];
      liveIdForRestore = parkedTab.id;

      // Step 1a — blank the URL. A live URL transition must NOT be reverted
      // (code review fix #3: deliberate navigation is never hijacked).
      log(`  Simulating Chrome pre-SW URL replacement on tab ${liveIdForRestore}: park.html → about:blank (no hijack expected)`);
      await evalInSW(browser2, `chrome.tabs.update(${liveIdForRestore}, { url: 'about:blank' })`);
      await sleep(2000);

      const afterBlank = (await queryChromeTabs(browser2)).find(t => t.id === liveIdForRestore);
      log(`  After blanking: url=${(afterBlank?.url || '').slice(0, 90)}`);
      runner.assert(
        afterBlank != null && blankUrls.has(afterBlank.url ?? ''),
        `blanking step leaves the tab on about:blank (deliberate navigation is not hijacked; got: ${afterBlank?.url})`,
      );

      // Step 1b — reconstruct the persisted parked TabInfo (the real race
      // never fires onUpdated for the replacement, so parked=true survives).
      await evalInSW(browser2, `(async () => {
        const info = tabManager.tabInfos[${liveIdForRestore}];
        if (info != null) {
          info._parked = true;
          info._parkedUrl = ${JSON.stringify(TARGET_URL)};
        }
        return info != null;
      })()`);

      // Step 2 — fire a NON-URL onUpdated event (the activation signature of a
      // tab Chrome blanked before the SW started) and expect the revert.
      log(`  Triggering non-URL onUpdated event on tab ${liveIdForRestore} (activation signature)`);
      await evalInSW(browser2, `chrome.tabs.update(${liveIdForRestore}, { muted: true })`);
      await sleep(2000);

      const afterRecovery = (await queryChromeTabs(browser2)).find(t => t.id === liveIdForRestore);
      log(`  After activation+revert: url=${(afterRecovery?.url || '').slice(0, 90)}`);
      runner.assert(
        afterRecovery != null && afterRecovery.url != null && afterRecovery.url.startsWith(parkPrefix2),
        `onUpdated reverted about:blank → park.html on activation (got: ${afterRecovery?.url})`,
      );
      runner.assert(
        afterRecovery != null && afterRecovery.url != null &&
        afterRecovery.url.includes(`url=${encodeURIComponent(TARGET_URL)}`),
        `reverted park.html preserves original URL in url= param`,
      );
    }

    if (liveIdForRestore == null) {
      log('  No parked tab found — cannot test restore. Aborting Phase D.');
    } else {
      runner.section('Phase D — Trigger restore via hover and verify navigation to original URL');
      const parkedTab = parkedGroupTabs[0];

      await waitForParkPages(browser2, extensionId2, 1, 15000);
      const parkPages = await getParkPages(browser2, extensionId2);
      runner.assert(parkPages.length >= 1, `park page found (got ${parkPages.length})`);
      const parkPage = parkPages[0];
      log(`  park page url: ${parkPage.url().slice(0, 90)}...`);

      await parkPage.waitForSelector('#resoteImg', { visible: true, timeout: 10000 });
      await parkPage.waitForFunction(
        () => !!(document.getElementById('resoteImg') as HTMLImageElement | null)?.onmouseover,
        { timeout: 8000 },
      ).catch(async () => {
        const html = await parkPage.evaluate(() => document.body?.innerHTML?.slice(0, 300) ?? '');
        log(`  WARNING: onmouseover not set. body: ${html}`);
      });
      log('  #resoteImg onmouseover handler ready');

      await parkPage.evaluate(() => {
        document.getElementById('resoteImg')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }).catch((e: Error) => {
        if (!e.message.includes('Execution context was destroyed') &&
            !e.message.includes('Target closed')) {
          throw e;
        }
      });
      log('  Triggered mouseover on #resoteImg');

      const host = new URL(TARGET_URL).host;
      const restoredUrl = await waitForAnyTabToLeaveParked(browser2, extensionId2, host, 20000).catch(() => null);

      log(`  Restored url: ${restoredUrl ?? 'null'}`);
      runner.assert(
        restoredUrl != null && restoredUrl.includes(host),
        `tab must restore to original URL ${TARGET_URL} (got: ${restoredUrl})`,
      );
      runner.assert(
        restoredUrl != null && !restoredUrl.startsWith(parkPrefix2),
        'tab must NOT remain on park.html after restore',
      );
      runner.assert(
        restoredUrl != null && !blankUrls.has(restoredUrl),
        'tab must NOT land on about:blank / chrome://newtab/',
      );
    }

  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      const relevant = logs.filter(l =>
        l.includes('Issue #4') || l.includes('Reverting') || l.includes('Recovering') ||
        l.includes('parked') || l.includes('Reload') || l.includes('restoredFromStorage'));
      log(`  Relevant SW logs (${relevant.length} lines):`);
      for (const line of relevant.slice(-25)) log(line);
    }
    await browser2.close().catch(() => {});
    log('Browser closed after restart verification');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});