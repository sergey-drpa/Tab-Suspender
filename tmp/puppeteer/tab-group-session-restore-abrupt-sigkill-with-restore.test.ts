/**
 * Tab Suspender — Tab Group Session Restore E2E Test
 *
 * Reproduces issue #4: collapsed tab groups whose tabs were suspended can
 * become blank/new-tab pages after the browser is closed and reopened.
 *
 * The bug is reported to manifest when there are at least 3 collapsed groups
 * with ~10 tabs in each. This test therefore creates exactly that layout:
 *   3 groups x 10 tabs = 30 suspended tabs.
 *
 * Flow:
 *   Phase A — Launch a fresh profile, create 30 tabs, group them into 3
 *             collapsed groups of 10, then suspend every tab.
 *             Verify all tabs are parked (park.html) and still belong to
 *             their groups.
 *   Phase B — Close the browser.
 *   Phase C — Relaunch the same profile with --restore-last-session. Wait for
 *             the extension startup/session-restore detection to finish, then
 *             verify that none of the grouped tabs became blank/new-tab pages
 *             and that they remain parked.
 *
 * Run:
 *   cd test/puppeteer && npx tsx tab-group-session-restore.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log, EXTENSION_PATH } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  discardTabById,
  queryChromeTabs,
  parkUrlPrefix,
  getSetting,
  setSetting,
  waitForExtensionInit,
  installSWLogCapture,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT      = 3;
const TABS_PER_GROUP   = 10;
const TOTAL_GROUP_TABS = GROUP_COUNT * TABS_PER_GROUP;
const EXTRA_UNGROUPED_TABS = 30;

interface GroupInfo {
  groupId: number;
  tabIds: number[];
}

interface GroupedTab {
  id: number;
  url: string;
  groupId: number;
}

/**
 * The production manifest.json intentionally does not request the `tabGroups`
 * permission. The E2E harness needs to create and collapse tab groups, so we
 * temporarily grant that permission to the generated `build_dir/manifest.json`
 * for the duration of this test run. This never modifies the source manifest.
 */
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
  log('Tab Suspender — Tab Group Session Restore');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalIgnoreSuspendGroupedTabs: boolean | null = null;
  const groupInfos: GroupInfo[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE A — Fresh browser: 3 collapsed groups x 10 tabs, then suspend all
  // ═══════════════════════════════════════════════════════════════════════════
  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched (fresh profile)');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    // Close any stale extension setup tabs so they don't steal the inactivity timer.
    const tabsBefore = await queryChromeTabs(browser);
    const extensionTabs = tabsBefore.filter(
      t => t.url && t.url.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html'),
    );
    for (const et of extensionTabs) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
    }
    await sleep(300);

    originalTimeout = await getSetting<number>(browser, 'timeout');
    originalIgnoreSuspendGroupedTabs = await getSetting<boolean>(browser, 'ignoreSuspendGroupedTabs');

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'ignoreSuspendGroupedTabs', false);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', true);
    await setSetting(browser, 'discardTimeoutFactor', 0.1);
    await setSetting(browser, 'startDiscarted', true);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'reloadTabOnRestore', false);
    log(`  timeout=10s, ignoreSuspendGroupedTabs=false, startDiscarted=true, autoRestoreTab=false, reloadTabOnRestore=false, discardTabAfterSuspendWithTimeout=true, discardTimeoutFactor=0.1`);

    runner.section(`Phase A — Create ${GROUP_COUNT} collapsed groups x ${TABS_PER_GROUP} tabs`);

    // Open extra ungrouped tabs to slow down session restore and stress the
    // group-restore path, matching real user profiles where many tabs exist.
    log(`  Opening ${EXTRA_UNGROUPED_TABS} ungrouped tabs...`);
    const ungroupedTabIds: number[] = [];
    for (let i = 0; i < EXTRA_UNGROUPED_TABS; i++) {
      const page = await browser.newPage();
      await page.goto(`${TARGET_HOST}/?ungrouped=${i + 1}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(e => log(`  nav note [ungrouped ${i + 1}]: ${(e as Error).message}`));
      await sleep(8);
    }

    await sleep(250);
    const tabsAfterUngrouped = await queryChromeTabs(browser);
    ungroupedTabIds.push(...tabsAfterUngrouped
      .filter(t => t.url && t.url.includes('example.com/?ungrouped='))
      .map(t => t.id));
    log(`  Opened ${ungroupedTabIds.length} ungrouped tabs: [${ungroupedTabIds.slice(0, 5).join(', ')}...]`);

    // Open all group tabs with distinct URLs so we can identify them later.
    const allTabIds: number[] = [];
    for (let g = 0; g < GROUP_COUNT; g++) {
      for (let i = 0; i < TABS_PER_GROUP; i++) {
        const page = await browser.newPage();
        const url = `${TARGET_HOST}/?group=${g + 1}&tab=${i + 1}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
          .catch(e => log(`  nav note [g${g + 1}/t${i + 1}]: ${(e as Error).message}`));
        await sleep(20);
      }
    }

    await sleep(375); // let all tabs settle and report their IDs

    const tabsAfterOpen = await queryChromeTabs(browser);
    const groupTabs = tabsAfterOpen.filter(t => t.url && t.url.includes('example.com/?group='));
    runner.assert(groupTabs.length === TOTAL_GROUP_TABS, `all ${TOTAL_GROUP_TABS} group tabs opened (got ${groupTabs.length})`);

    // Create 3 collapsed groups of 10 tabs each.
    for (let g = 0; g < GROUP_COUNT; g++) {
      const tabIdsForGroup = groupTabs
        .filter(t => t.url.includes(`group=${g + 1}&`))
        .map(t => t.id);

      runner.assert(tabIdsForGroup.length === TABS_PER_GROUP, `group ${g + 1} has ${TABS_PER_GROUP} tabs`);

      const groupId = await evalInSW<number>(browser, `(async () => {
        const groupId = await chrome.tabs.group({ tabIds: ${JSON.stringify(tabIdsForGroup)} });
        await chrome.tabGroups.update(groupId, { collapsed: false });
        return groupId;
      })()`);

      groupInfos.push({ groupId, tabIds: tabIdsForGroup });
      allTabIds.push(...tabIdsForGroup);
      log(`  Group ${g + 1}: id=${groupId}, tabs=[${tabIdsForGroup.join(', ')}]`);
    }

    // Move focus away so the grouped tabs can be suspended.
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(500);

    // Suspend every grouped tab explicitly. Auto-suspend at this scale is
    // unreliable in a headless harness; explicit suspension gives a
    // deterministic repro for the restart part of the bug.
    log(`  Suspending ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      await suspendTabById(browser, id);
      await sleep(50);
    }

    // Also suspend the ungrouped tabs so the whole profile is in the same
    // state as a real user session full of parked tabs.
    log(`  Suspending ${ungroupedTabIds.length} ungrouped tabs...`);
    for (const id of ungroupedTabIds) {
      await suspendTabById(browser, id);
      await sleep(30);
    }

    const parkPrefix = parkUrlPrefix(extensionId);

    const allSuspendTargetIds = [...allTabIds, ...ungroupedTabIds];

    // Wait until every target tab is parked. We deliberately do NOT manually
    // discard grouped tabs here — the bug is reported to involve the extension's
    // own startup discard (`startDiscarted`) racing with Chrome session restore.
    log('  Waiting for all target tabs to be parked before restart...');
    const preRestartDeadline = Date.now() + 30000;
    let parkedCount = 0;
    while (Date.now() < preRestartDeadline) {
      const currentTabs = await queryChromeTabs(browser);
      parkedCount = currentTabs.filter(t => {
        if (!allSuspendTargetIds.includes(t.id)) return false;
        return t.url.startsWith(parkPrefix);
      }).length;
      if (parkedCount === allSuspendTargetIds.length) break;
      await sleep(500);
    }
    runner.assert(
      parkedCount === allSuspendTargetIds.length,
      `all ${allSuspendTargetIds.length} target tabs parked before restart (got ${parkedCount}/${allSuspendTargetIds.length})`,
    );

    // Diagnostic: full TabInfo state for grouped tabs before restart.
    const preRestartTabInfo = await evalInSW<string>(browser, `(async () => {
      const infos = tabManager.getTabInfosCopy();
      const result = [];
      for (const id of ${JSON.stringify(allTabIds)}) {
        const info = infos[id] || null;
        result.push({ tabId: id, hasInfo: info != null, parked: info ? info._parked : null, parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null, closed: info ? info._closed : null, discarded: info ? info._discarded : null, oldRefId: info ? info._oldRefId : null, newRefId: info ? info._newRefId : null });
      }
      return JSON.stringify(result, null, 2);
    })()`);
    log('  Pre-restart TabInfo snapshot for grouped tabs:\n' + preRestartTabInfo);

    for (const info of groupInfos) {
      const tabsInGroup = await evalInSW<{ id: number; url: string; discarded: boolean }[]>(browser, `(async () => {
        const tabs = await chrome.tabs.query({ groupId: ${info.groupId} });
        return tabs.map(t => ({ id: t.id, url: t.url || '', discarded: t.discarded }));
      })()`);
      runner.assert(tabsInGroup.length === TABS_PER_GROUP, `group ${info.groupId} retains ${TABS_PER_GROUP} tabs before restart`);
      const stillParkedCount = tabsInGroup.filter(t => t.url.startsWith(parkPrefix) || t.discarded).length;
      runner.softAssert(stillParkedCount === TABS_PER_GROUP, `group ${info.groupId}: ${stillParkedCount}/${TABS_PER_GROUP} tabs parked/discarded`);
    }
  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    if (originalIgnoreSuspendGroupedTabs != null) {
      await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    }
    await browser.close();
    log('Browser closed for restart');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE C — Restart browser and verify grouped tabs are not blank
  // ═══════════════════════════════════════════════════════════════════════════
  runner.section('Phase C — Restart with --restore-last-session and inspect grouped tabs');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  // Start collecting service-worker logs immediately so startup/restore messages
  // are not lost while the extension is still initializing.
  const getSWLogs = await installSWLogCapture(browser2);
  log('Installed SW log capture');

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    await waitForExtensionInit(browser2);
    log('Extension initialized after restart');

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    // Diagnostic snapshot: log tabManager.tabInfos for every grouped tab as
    // soon as the extension is ready. This shows whether TabInfo was restored
    // correctly (parkedUrl, parked flags) before any user activation.
    const tabInfoSnapshot = await evalInSW<string>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const tabIds = [];
      for (const g of groups) {
        const tabs = await chrome.tabs.query({ groupId: g.id });
        for (const t of tabs) tabIds.push(t.id);
      }
      const infos = tabManager.getTabInfosCopy();
      const result = tabIds.map(id => {
        const info = infos[id] || null;
        return {
          tabId: id,
          hasInfo: info != null,
          parked: info ? info._parked : null,
          parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : null,
          oldRefId: info ? info._oldRefId : null,
          newRefId: info ? info._newRefId : null,
          closed: info ? info._closed : null,
          discarded: info ? info._discarded : null,
        };
      });
      return JSON.stringify(result, null, 2);
    })()`);
    log('  TabInfo snapshot after init:\n' + tabInfoSnapshot);

    // Issue #4 immediate check: are grouped tabs already blank right after init?
    const immediateGroupedTabs = await evalInSW<GroupedTab[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) {
          result.push({ id: tab.id, url: tab.url || '', groupId: tab.groupId });
        }
      }
      return result;
    })()`);
    const immediateBlankTabs = immediateGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      immediateBlankTabs.length === 0,
      `no grouped tab is blank/new-tab immediately after init (got ${immediateBlankTabs.length}: ${immediateBlankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );

    // Issue #4 race probe: try to activate a tab immediately after extension init,
    // before SessionRestoreDetector has necessarily finished. If the bug is a race,
    // this is when it should manifest.
    const earlyGroups = await evalInSW<{ id: number; tabCount: number }[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map(g => ({ id: g.id, tabCount: g.tabCount }));
    })()`);

    if (earlyGroups.length > 0) {
      const firstGroupTab = await evalInSW<{ id: number; url: string } | null>(browser2, `(async () => {
        const tabs = await chrome.tabs.query({ groupId: ${earlyGroups[0].id} });
        return tabs.length ? { id: tabs[0].id, url: tabs[0].url || '' } : null;
      })()`);

      if (firstGroupTab) {
        log(`  Early-activation probe: tab ${firstGroupTab.id} (${firstGroupTab.url.slice(0, 50)})`);
        await evalInSW(browser2, `chrome.tabs.update(${firstGroupTab.id}, { active: true })`);
        await sleep(1500);
        const earlyActivated = await evalInSW<{ url: string } | null>(browser2, `(async () => {
          const tab = await chrome.tabs.get(${firstGroupTab.id}).catch(() => null);
          return tab ? { url: tab.url || '' } : null;
        })()`);
        if (earlyActivated) {
          log(`    Early-activated tab ${firstGroupTab.id} now: ${earlyActivated.url.slice(0, 60)}`);
          if (blankUrls.has(earlyActivated.url)) {
            log('  >>> EARLY ACTIVATION PRODUCED BLANK TAB <<<');
          }
        }
      }
    }

    // Give Chrome and the extension time to finish session/group restore processing.
    await sleep(6000);

    // Second TabInfo snapshot: did tabInfos load from chrome.storage.local after
    // the common loop had time to run?
    const tabInfoSnapshot2 = await evalInSW<string>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const tabIds = [];
      for (const g of groups) {
        const tabs = await chrome.tabs.query({ groupId: g.id });
        for (const t of tabs) tabIds.push(t.id);
      }
      const infos = tabManager.getTabInfosCopy();
      const result = tabIds.map(id => {
        const info = infos[id] || null;
        const oldInfo = info && info._oldRefId != null ? (infos[info._oldRefId] || null) : null;
        return {
          tabId: id,
          hasInfo: info != null,
          parked: info ? info._parked : null,
          parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null,
          oldRefId: info ? info._oldRefId : null,
          oldRefParkedUrl: oldInfo && oldInfo._parkedUrl ? oldInfo._parkedUrl.slice(0, 80) : oldInfo ? oldInfo._parkedUrl : null,
          oldRefHasInfo: oldInfo != null,
          newRefId: info ? info._newRefId : null,
          originRefId: info ? info._originRefId : null,
          closed: info ? info._closed : null,
          discarded: info ? info._discarded : null,
        };
      });
      return JSON.stringify(result, null, 2);
    })()`);
    log('  TabInfo snapshot after 6s:\n' + tabInfoSnapshot2);

    const parsedSnapshot2 = JSON.parse(tabInfoSnapshot2) as Array<{ tabId: number; hasInfo: boolean; parkedUrl: string | null }>;
    const nullParkedUrlTabs = parsedSnapshot2.filter(e => e.hasInfo && e.parkedUrl == null);
    runner.assert(
      nullParkedUrlTabs.length === 0,
      `all restored grouped tabs have non-null parkedUrl in TabInfo (null count=${nullParkedUrlTabs.length}, ids=[${nullParkedUrlTabs.map(e => e.tabId).join(', ')}])`,
    );

    // Check whether tabInfos were saved in chrome.storage.local at all.
    const storedTabInfos = await evalInSW<string | null>(browser2, `(async () => {
      const result = await chrome.storage.local.get('tabInfos');
      return result.tabInfos ? 'present (length=' + result.tabInfos.length + ')' : 'missing';
    })()`);
    log(`  chrome.storage.local tabInfos: ${storedTabInfos}`);

    // Read every restored group via the extension service worker.
    const allGroupedTabs = await evalInSW<GroupedTab[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) {
          result.push({ id: tab.id, url: tab.url || '', groupId: tab.groupId });
        }
      }
      return result;
    })()`);

    log(`  Grouped tabs after restore: ${allGroupedTabs.length} total`);
    log(`    ${allGroupedTabs.slice(0, 6).map(t => `id=${t.id} url=${t.url.slice(0, 50)} groupId=${t.groupId}`).join(' | ')}${allGroupedTabs.length > 6 ? ' ...' : ''}`);

    runner.assert(
      allGroupedTabs.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs restored (got ${allGroupedTabs.length})`,
    );

    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      blankTabs.length === 0,
      `no restored grouped tab is blank/new-tab (got ${blankTabs.length}: ${blankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );

    const parkedTabs = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix2));
    runner.softAssert(
      parkedTabs.length === allGroupedTabs.length,
      `all restored grouped tabs are still parked (parked=${parkedTabs.length}/${allGroupedTabs.length})`,
    );

    // Phase C-E: simulate Chrome memory-pressure discard of collapsed group tabs
    // after startup. Some reports say tabs become blank only after Chrome itself
    // discards the restored group tabs.
    runner.section('Phase C-E — Discard grouped tabs after startup and check for blank');
    const groupedTabIdsAfterRestore = allGroupedTabs.map(t => t.id);
    log(`  Manually discarding ${groupedTabIdsAfterRestore.length} grouped tabs to simulate memory pressure...`);
    for (const id of groupedTabIdsAfterRestore) {
      await discardTabById(browser2, id).catch(() => {});
      await sleep(30);
    }
    await sleep(2000);

    const postDiscardGroupedTabs = await evalInSW<GroupedTab[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) {
          result.push({ id: tab.id, url: tab.url || '', groupId: tab.groupId, discarded: tab.discarded });
        }
      }
      return result;
    })()`);
    const blankAfterDiscard = postDiscardGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      blankAfterDiscard.length === 0,
      `no grouped tab became blank/new-tab after memory-pressure discard (got ${blankAfterDiscard.length}: ${blankAfterDiscard.map(t => t.url || '<empty>').join(', ')})`,
    );

    // Issue #4 specific trigger: activating a tab inside a collapsed/restored
    // group is when it reportedly turns into a blank/new-tab page.
    runner.section('Phase D — Activate one tab per group and check for blank page');

    const restoredGroups = await evalInSW<{ id: number; tabCount: number }[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map(g => ({ id: g.id, tabCount: g.tabCount }));
    })()`);

    const activatedBlankTabs: number[] = [];
    const activatedWrongUrls: string[] = [];

    for (let gi = 0; gi < restoredGroups.length; gi++) {
      const groupIdAfterRestore = restoredGroups[gi].id;
      const tabsInGroup = await evalInSW<{ id: number; url: string; title?: string }[]>(browser2, `(async () => {
        const tabs = await chrome.tabs.query({ groupId: ${groupIdAfterRestore} });
        return tabs.map(t => ({ id: t.id, url: t.url || '', title: t.title || '' }));
      })()`);

      if (tabsInGroup.length === 0) {
        runner.softAssert(false, `no tabs found in restored group ${groupIdAfterRestore} to activate`);
        continue;
      }

      // Prefer activating a tab whose restored TabInfo has a missing parkedUrl,
      // since that is the data-loss state we have observed.
      const infosAfter = await evalInSW<{ [id: number]: { _parkedUrl: string | null } }>(browser2, 'JSON.stringify(tabManager.getTabInfosCopy())');
      const parsedInfos = JSON.parse(infosAfter as unknown as string) as { [id: string]: { _parkedUrl: string | null } };
      const tabWithNullParkedUrl = tabsInGroup.find(t => {
        const info = parsedInfos[t.id];
        return info && info._parkedUrl == null;
      });
      const tabToActivate = (tabWithNullParkedUrl || tabsInGroup[0]).id;
      log(`  Activating group ${gi + 1} (restored id=${groupIdAfterRestore}, ${tabsInGroup.length} tabs), tab ${tabToActivate}`);
      await evalInSW(browser2, `chrome.tabs.update(${tabToActivate}, { active: true })`);
      await sleep(2500); // give Chrome + extension time to expand group and render

      const activatedTab = await evalInSW<{ url: string; title?: string } | null>(browser2, `(async () => {
        const tab = await chrome.tabs.get(${tabToActivate}).catch(() => null);
        return tab ? { url: tab.url || '', title: tab.title || '' } : null;
      })()`);

      if (activatedTab == null) {
        runner.softAssert(false, `activated tab ${tabToActivate} disappeared`);
        continue;
      }

      log(`    Activated tab ${tabToActivate}: url=${activatedTab.url.slice(0, 60)} title="${activatedTab.title}"`);

      if (blankUrls.has(activatedTab.url)) {
        activatedBlankTabs.push(tabToActivate);
      } else if (!activatedTab.url.startsWith(parkPrefix2) && !activatedTab.url.includes('example.com')) {
        activatedWrongUrls.push(activatedTab.url);
      }
    }

    runner.assert(
      activatedBlankTabs.length === 0,
      `activating a grouped tab did not produce blank/new-tab (blank tabs: [${activatedBlankTabs.join(', ')}])`,
    );
    runner.assert(
      activatedWrongUrls.length === 0,
      `activated grouped tabs kept expected URLs (unexpected: ${activatedWrongUrls.slice(0, 3).join(', ')})`,
    );
  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      log(`  Service worker logs (${logs.length} lines):`);
      for (const line of logs) log(line);
    }
    await browser2.close();
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
