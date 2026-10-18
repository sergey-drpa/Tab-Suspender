/**
 * Tab Suspender — Tab Group Session Restore E2E Test (autoRestore variant)
 *
 * Reproduces issue #4 with the settings reported by users: autoRestoreTab=true
 * and reloadTabOnRestore=true. The hypothesis is that when a grouped tab is
 * activated before tabInfos finish restoring, a missing `parkedUrl` causes the
 * restore path to reload a blank/new-tab page instead of the original URL.
 *
 * Flow:
 *   Phase A — Fresh profile: 3 uncollapsed groups x 10 tabs + 30 ungrouped tabs.
 *             Suspend every tab and wait for park.html.
 *   Phase B — Close the browser.
 *   Phase C — Relaunch with --restore-last-session. Poll TabInfo at 200 ms
 *             intervals immediately after relaunch to catch transient data loss.
 *             Activate one tab per group at various timings and check for blank.
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
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-autorestore');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT          = 3;
const TABS_PER_GROUP       = 10;
const TOTAL_GROUP_TABS     = GROUP_COUNT * TABS_PER_GROUP;
const EXTRA_UNGROUPED_TABS = 30;

interface GroupInfo {
  groupId: number;
  tabIds: number[];
}

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
  log('Tab Suspender — Tab Group Session Restore (autoRestore repro)');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalIgnoreSuspendGroupedTabs: boolean | null = null;
  let originalAutoRestoreTab: boolean | null = null;
  let originalReloadTabOnRestore: boolean | null = null;
  const groupInfos: GroupInfo[] = [];

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
    originalIgnoreSuspendGroupedTabs = await getSetting<boolean>(browser, 'ignoreSuspendGroupedTabs');
    originalAutoRestoreTab = await getSetting<boolean>(browser, 'autoRestoreTab');
    originalReloadTabOnRestore = await getSetting<boolean>(browser, 'reloadTabOnRestore');

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'ignoreSuspendGroupedTabs', false);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', true);
    await setSetting(browser, 'discardTimeoutFactor', 0.1);
    await setSetting(browser, 'startDiscarted', true);
    await setSetting(browser, 'autoRestoreTab', true);
    await setSetting(browser, 'reloadTabOnRestore', true);
    log('  settings: timeout=10s, ignoreSuspendGroupedTabs=false, discardTabAfterSuspendWithTimeout=true, discardTimeoutFactor=0.1, startDiscarted=true, autoRestoreTab=true, reloadTabOnRestore=true');

    runner.section(`Phase A — Create ${GROUP_COUNT} uncollapsed groups x ${TABS_PER_GROUP} tabs + ${EXTRA_UNGROUPED_TABS} ungrouped`);

    log(`  Opening ${EXTRA_UNGROUPED_TABS} ungrouped tabs...`);
    const ungroupedTabIds: number[] = [];
    for (let i = 0; i < EXTRA_UNGROUPED_TABS; i++) {
      const page = await browser.newPage();
      await page.goto(`${TARGET_HOST}/?ungrouped=${i + 1}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(e => log(`  nav note [ungrouped ${i + 1}]: ${(e as Error).message}`));
      await sleep(10);
    }

    await sleep(500);
    const tabsAfterUngrouped = await queryChromeTabs(browser);
    ungroupedTabIds.push(...tabsAfterUngrouped
      .filter(t => t.url && t.url.includes('example.com/?ungrouped='))
      .map(t => t.id));
    log(`  Opened ${ungroupedTabIds.length} ungrouped tabs`);

    const allTabIds: number[] = [];
    for (let g = 0; g < GROUP_COUNT; g++) {
      for (let i = 0; i < TABS_PER_GROUP; i++) {
        const page = await browser.newPage();
        const url = `${TARGET_HOST}/?group=${g + 1}&tab=${i + 1}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
          .catch(e => log(`  nav note [g${g + 1}/t${i + 1}]: ${(e as Error).message}`));
        await sleep(25);
      }
    }

    await sleep(750);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const groupTabs = tabsAfterOpen.filter(t => t.url && t.url.includes('example.com/?group='));
    runner.assert(groupTabs.length === TOTAL_GROUP_TABS, `all ${TOTAL_GROUP_TABS} group tabs opened (got ${groupTabs.length})`);

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
      log(`  Group ${g + 1}: id=${groupId}, tabs=[${tabIdsForGroup.slice(0, 3).join(', ')}...]`);
    }

    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(500);

    log(`  Suspending ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      await suspendTabById(browser, id);
      await sleep(50);
    }

    log(`  Suspending ${ungroupedTabIds.length} ungrouped tabs...`);
    for (const id of ungroupedTabIds) {
      await suspendTabById(browser, id);
      await sleep(30);
    }

    const parkPrefix = parkUrlPrefix(extensionId);
    const allSuspendTargetIds = [...allTabIds, ...ungroupedTabIds];

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
  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    if (originalIgnoreSuspendGroupedTabs != null) {
      await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    }
    if (originalAutoRestoreTab != null) {
      await setSetting(browser, 'autoRestoreTab', originalAutoRestoreTab).catch(() => {});
    }
    if (originalReloadTabOnRestore != null) {
      await setSetting(browser, 'reloadTabOnRestore', originalReloadTabOnRestore).catch(() => {});
    }
    await browser.close();
    log('Browser closed for restart');
  }

  runner.section('Phase C — Restart with --restore-last-session and activate grouped tabs early');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    // Install instrumentation ASAP: log when tabInfos loads and when onReplaced/onUpdated fires.
    // These logs persist only in the SW console; we also capture snapshots below.
    await evalInSW(browser2, `(async () => {
      const origLoad = tabManager.loadTabInfos.bind(tabManager);
      tabManager.loadTabInfos = async function() {
        console.log('[SW-INSTRUMENT] loadTabInfos START');
        const result = await origLoad();
        console.log('[SW-INSTRUMENT] loadTabInfos DONE, keys=' + Object.keys(tabManager.tabInfos || {}).length);
        return result;
      };
      const origStore = tabManager.storeTabInfos.bind(tabManager);
      tabManager.storeTabInfos = async function() {
        console.log('[SW-INSTRUMENT] storeTabInfos START');
        const result = await origStore();
        console.log('[SW-INSTRUMENT] storeTabInfos DONE');
        return result;
      };
      const origReplace = tabManager.onTabReplaceDetected.bind(tabManager);
      tabManager.onTabReplaceDetected = function(addedTabId, removedTabId) {
        const infos = tabManager.tabInfos || {};
        const oldInfo = infos[removedTabId] || null;
        console.log('[SW-INSTRUMENT] onTabReplaceDetected added=' + addedTabId + ' removed=' + removedTabId + ' oldInfo=' + (oldInfo != null) + ' oldParkedUrl=' + (oldInfo && oldInfo._parkedUrl ? oldInfo._parkedUrl.slice(0, 60) : oldInfo ? oldInfo._parkedUrl : 'null'));
        return origReplace(addedTabId, removedTabId);
      };
      const origUpdated = tabManager.onUpdated.bind(tabManager);
      tabManager.onUpdated = function(tabId, changeInfo, tab) {
        if (changeInfo && changeInfo.url != null) {
          const infos = tabManager.tabInfos || {};
          const info = infos[tabId] || null;
          if (info && info._parked) {
            console.log('[SW-INSTRUMENT] onUpdated parked tabId=' + tabId + ' changeUrl=' + changeInfo.url.slice(0, 60) + ' parkedUrl=' + (info._parkedUrl ? info._parkedUrl.slice(0, 60) : 'null'));
          }
        }
        return origUpdated(tabId, changeInfo, tab);
      };
      return 'instrumented';
    })()`).catch(e => log(`  instrumentation warning: ${(e as Error).message}`));

    // Wait for extension init (whiteList ready) but do NOT wait for session restore.
    await waitForExtensionInit(browser2);
    log('Extension initialized after restart');

    // Immediately poll TabInfo every 200 ms for the first 10 s to catch transient loss.
    log('  Polling TabInfo immediately after init (200 ms intervals)');
    const immediateSnapshots: { atMs: number; snapshot: unknown }[] = [];
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      const snap = await evalInSW<string>(browser2, `(async () => {
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
            newRefId: info ? info._newRefId : null,
            originRefId: info ? info._originRefId : null,
            closed: info ? info._closed : null,
            discarded: info ? info._discarded : null,
          };
        });
        return JSON.stringify({ at: Date.now(), count: tabIds.length, entries: result });
      })()`).catch(() => null);
      if (snap) immediateSnapshots.push(JSON.parse(snap));
      await sleep(200);
    }

    // Log any snapshot where parkedUrl is missing for a grouped tab.
    const nullParkedSnapshots = immediateSnapshots.map(s => ({
      atMs: s.at as number,
      nullCount: (s.entries as any[]).filter((e: any) => e.parkedUrl == null).length,
      nullIds: (s.entries as any[]).filter((e: any) => e.parkedUrl == null).map((e: any) => e.tabId),
    }));
    log('  Immediate snapshots null parkedUrl summary: ' + JSON.stringify(nullParkedSnapshots, null, 2));

    // Try activating one tab per group at different timings during the 10 s window.
    runner.section('Phase D — Activate one tab per group during restore window');
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
        runner.softAssert(false, `no tabs found in restored group ${groupIdAfterRestore}`);
        continue;
      }

      // Activate a tab from this group. Try to pick one with null parkedUrl if possible.
      const infosNow = await evalInSW<string>(browser2, 'JSON.stringify(tabManager.getTabInfosCopy())');
      const parsedInfos = JSON.parse(infosNow as unknown as string) as { [id: string]: { _parkedUrl: string | null } };
      const tabWithNullParkedUrl = tabsInGroup.find(t => {
        const info = parsedInfos[t.id];
        return info && info._parkedUrl == null;
      });
      const tabToActivate = (tabWithNullParkedUrl || tabsInGroup[0]).id;

      log(`  Activating group ${gi + 1} tab ${tabToActivate} (url: ${(tabWithNullParkedUrl || tabsInGroup[0]).url.slice(0, 50)})`);
      await evalInSW(browser2, `chrome.tabs.update(${tabToActivate}, { active: true })`);
      await sleep(2500);

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
        log('  >>> ACTIVATION PRODUCED BLANK TAB <<<');
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

    // Final state check.
    const finalGroupedTabs = await evalInSW<{ id: number; url: string }[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id });
      }
      return result;
    })()`);

    const finalBlankTabs = finalGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      finalBlankTabs.length === 0,
      `no final grouped tab is blank/new-tab (got ${finalBlankTabs.length})`,
    );
  } finally {
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
