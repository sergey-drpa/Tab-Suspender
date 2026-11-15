/**
 * Tab Suspender — Tab Group Session Restore E2E Test (TRUE abrupt SIGKILL)
 *
 * Variant of tab-group-session-restore-abrupt.test.ts that actually sends
 * SIGKILL to the Chrome process, instead of doing a graceful browser.close().
 * This tests whether Chrome's session restore engine alone can corrupt the
 * park.html url query parameter for collapsed, discarded grouped tabs.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { type Browser } from 'puppeteer';
import { launchBrowser, sleep, log, EXTENSION_PATH, getBrowserPID, copyCurrentSessionToLastSession, markProfileCrashed } from './base/BrowserHelper.js';
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-abrupt-sigkill-expanded');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT          = 3;
const TABS_PER_GROUP       = 10;
const TOTAL_GROUP_TABS     = GROUP_COUNT * TABS_PER_GROUP;
const EXTRA_UNGROUPED_TABS = 30;

interface GroupInfo {
  groupId: number;
  tabIds: number[];
}

interface GroupedTab {
  id: number;
  url: string;
  groupId: number;
  discarded?: boolean;
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

async function killBrowserAbruptly(browser: Browser): Promise<void> {
  const pid = getBrowserPID(browser);
  if (pid == null) {
    log('  Could not get browser PID; falling back to graceful close');
    await browser.close().catch(() => {});
    return;
  }
  log(`  Sending SIGKILL to Chrome process ${pid}`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    log(`  SIGKILL failed: ${(e as Error).message}; falling back to graceful close`);
    await browser.close().catch(() => {});
  }
  // Give the OS time to release the profile lock.
  await sleep(2000);
}

async function main(): Promise<void> {
  log('Tab Suspender — Tab Group Session Restore (TRUE abrupt SIGKILL, expanded groups, auto-discard)');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalIgnoreSuspendGroupedTabs: boolean | null = null;
  let originalStartNormalTabsDiscarted: boolean | null = null;
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
    originalStartNormalTabsDiscarted = await getSetting<boolean>(browser, 'startNormalTabsDiscarted');

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'ignoreSuspendGroupedTabs', false);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', true);
    await setSetting(browser, 'discardTimeoutFactor', 0.1);
    await setSetting(browser, 'startDiscarted', true);
    await setSetting(browser, 'startNormalTabsDiscarted', true);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'reloadTabOnRestore', false);
    log('  settings: timeout=10s, ignoreSuspendGroupedTabs=false, discardTabAfterSuspendWithTimeout=true, discardTimeoutFactor=0.1, startDiscarted=true, startNormalTabsDiscarted=true, autoRestoreTab=false, reloadTabOnRestore=false');

    runner.section(`Phase A — Create ${GROUP_COUNT} collapsed groups x ${TABS_PER_GROUP} tabs + ${EXTRA_UNGROUPED_TABS} ungrouped`);

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

    await sleep(375);

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
      log(`  Group ${g + 1}: id=${groupId} (expanded), tabs=[${tabIdsForGroup.slice(0, 3).join(', ')}...]`);
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

    // Verify that every grouped parked tab has a real url parameter BEFORE the kill.
    const preKillParkedTabs = await queryChromeTabs(browser);
    const groupedParkedPreKill = preKillParkedTabs.filter(t => allTabIds.includes(t.id) && t.url.startsWith(parkPrefix));
    const blankUrlParamsPreKill: { tabId: number; url: string }[] = [];
    for (const t of groupedParkedPreKill) {
      const param = await evalInSW<string | null>(browser, `parseUrlParam(${JSON.stringify(t.url)}, 'url')`);
      if (!param || param === 'about:blank' || param === 'about:newtab' || param.startsWith('chrome://newtab')) {
        blankUrlParamsPreKill.push({ tabId: t.id, url: t.url });
      }
    }
    log(`  Pre-kill grouped parked tabs with blank/missing url param: ${blankUrlParamsPreKill.length}`);
    runner.assert(blankUrlParamsPreKill.length === 0, 'no grouped parked tab has blank url param before kill');

    runner.section('Phase A-E — Wait for auto-discard of parked expanded-group tabs before abrupt shutdown');
    const autoDiscardDeadline = Date.now() + 60000;
    let allGroupedDiscarded = false;
    while (Date.now() < autoDiscardDeadline) {
      const tabs = await queryChromeTabs(browser);
      const groupedParked = tabs.filter(t => allTabIds.includes(t.id) && t.url.startsWith(parkPrefix));
      const discardedCount = groupedParked.filter(t => t.discarded).length;
      log(`  Auto-discard progress: ${discardedCount}/${groupedParked.length} grouped parked tabs discarded`);
      if (groupedParked.length > 0 && discardedCount === groupedParked.length) {
        allGroupedDiscarded = true;
        break;
      }
      await sleep(2000);
    }
    runner.assert(allGroupedDiscarded, 'all grouped parked tabs auto-discarded before abrupt shutdown');

    const preKillGroupedTabs = await evalInSW<GroupedTab[]>(browser, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id, discarded: tab.discarded });
      }
      return result;
    })()`);
    log(`  Pre-kill grouped tabs: ${preKillGroupedTabs.length} total, ${preKillGroupedTabs.filter(t => t.discarded).length} discarded`);
  } finally {
    if (originalTimeout != null) {
      await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    }
    if (originalIgnoreSuspendGroupedTabs != null) {
      await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    }
    if (originalStartNormalTabsDiscarted != null) {
      await setSetting(browser, 'startNormalTabsDiscarted', originalStartNormalTabsDiscarted).catch(() => {});
    }

    await killBrowserAbruptly(browser);
    log('Browser killed for restart');
  }

  runner.section('Phase B2 — Prepare profile for SIGKILL session restore');
  // macOS Chrome stores sessions in Default/Sessions/ (binary Session_* / Tabs_* files),
  // not in Current Session / Last Session. Leave the Sessions folder as-is and mark
  // the profile as crashed so Chrome offers/forces restore on relaunch.
  markProfileCrashed(SESSION_DIR);

  runner.section('Phase C — Restart after SIGKILL and inspect grouped tabs');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore after SIGKILL');

  let getSWLogs: (() => Promise<string[]>) | null = null;

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    getSWLogs = await installSWLogCapture(browser2);
    log('Installed SW log capture');

    await waitForExtensionInit(browser2);
    log('Extension initialized after restart');

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    // Poll grouped tabs immediately after init to catch any transient about:blank state.
    const earlySnapshots: { atMs: number; total: number; blankCount: number; blankIds: number[]; nullUrlCount: number; nullUrlIds: number[] }[] = [];
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      const snap = await evalInSW<string>(browser2, `(async () => {
        const groups = await chrome.tabGroups.query({});
        const tabIds = [];
        for (const g of groups) {
          const tabs = await chrome.tabs.query({ groupId: g.id });
          for (const t of tabs) tabIds.push(t.id);
        }
        const result = [];
        for (const id of tabIds) {
          const tab = await chrome.tabs.get(id).catch(() => null);
          if (!tab) continue;
          const urlParam = tab.url.startsWith(parkPrefix2) ? parseUrlParam(tab.url, 'url') : null;
          result.push({ tabId: id, url: tab.url || '', urlParam });
        }
        return JSON.stringify({ at: Date.now(), count: result.length, entries: result });
      })()`).catch(() => null);
      if (snap) {
        const parsed = JSON.parse(snap);
        earlySnapshots.push({
          atMs: parsed.at,
          total: parsed.count,
          blankCount: parsed.entries.filter((e: any) => blankUrls.has(e.url)).length,
          blankIds: parsed.entries.filter((e: any) => blankUrls.has(e.url)).map((e: any) => e.tabId),
          nullUrlCount: parsed.entries.filter((e: any) => e.url.startsWith(parkUrl) && (!e.urlParam || e.urlParam === 'about:blank' || e.urlParam === 'about:newtab' || e.urlParam.startsWith('chrome://newtab'))).length,
          nullUrlIds: parsed.entries.filter((e: any) => e.url.startsWith(parkUrl) && (!e.urlParam || e.urlParam === 'about:blank' || e.urlParam === 'about:newtab' || e.urlParam.startsWith('chrome://newtab'))).map((e: any) => e.tabId),
        });
      }
      await sleep(200);
    }
    log('  Early restore snapshots: ' + JSON.stringify(earlySnapshots, null, 2));

    // Final state after the polling window.
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
        const oldInfo = info && info._oldRefId != null ? (infos[info._oldRefId] || null) : null;
        return {
          tabId: id,
          hasInfo: info != null,
          parked: info ? info._parked : null,
          parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null,
          oldRefId: info ? info._oldRefId : null,
          oldRefParkedUrl: oldInfo && oldInfo._parkedUrl ? oldInfo._parkedUrl.slice(0, 80) : oldInfo ? oldInfo._parkedUrl : null,
          closed: info ? info._closed : null,
          discarded: info ? info._discarded : null,
        };
      });
      return JSON.stringify(result, null, 2);
    })()`);
    log('  TabInfo snapshot after restart:\n' + tabInfoSnapshot);

    const allGroupedTabs = await evalInSW<GroupedTab[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id, discarded: tab.discarded });
      }
      return result;
    })()`);

    log(`  Grouped tabs after restore: ${allGroupedTabs.length} total`);
    log(`    ${allGroupedTabs.slice(0, 6).map(t => `id=${t.id} url=${t.url.slice(0, 50)} discarded=${t.discarded} groupId=${t.groupId}`).join(' | ')}${allGroupedTabs.length > 6 ? ' ...' : ''}`);

    // Check the actual url parameter of every grouped parked tab after SIGKILL restore.
    const groupedParkedPostRestore = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix2));
    const blankUrlParamsPostRestore: { tabId: number; url: string; param: string | null }[] = [];
    for (const t of groupedParkedPostRestore) {
      const param = await evalInSW<string | null>(browser2, `parseUrlParam(${JSON.stringify(t.url)}, 'url')`);
      if (!param || param === 'about:blank' || param === 'about:newtab' || param.startsWith('chrome://newtab')) {
        blankUrlParamsPostRestore.push({ tabId: t.id, url: t.url, param });
      }
    }
    log(`  Grouped parked tabs with blank/missing url param after SIGKILL restore: ${blankUrlParamsPostRestore.length}`);
    for (const e of blankUrlParamsPostRestore) log(`    tabId=${e.tabId} param=${e.param} url=${e.url.slice(0, 120)}`);

    runner.assert(
      groupedParkedPostRestore.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs are parked after SIGKILL restore (got ${groupedParkedPostRestore.length})`,
    );

    runner.assert(
      blankUrlParamsPostRestore.length === 0,
      `no grouped parked tab has blank/missing url parameter after SIGKILL restore (got ${blankUrlParamsPostRestore.length})`,
    );

    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      blankTabs.length === 0,
      `no restored grouped tab is blank/new-tab (got ${blankTabs.length}: ${blankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );

    // Phase D — activate one tab per group, as the user would do.
    runner.section('Phase D — Activate one tab per group and check for blank page');
    const restoredGroups = await evalInSW<{ id: number; tabCount: number; collapsed: boolean }[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map(g => ({ id: g.id, tabCount: g.tabCount, collapsed: g.collapsed }));
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

      const tabToActivate = tabsInGroup[0].id;

      log(`  Activating group ${gi + 1} (restored id=${groupIdAfterRestore}, collapsed=${restoredGroups[gi].collapsed}) tab ${tabToActivate}`);
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
      `activating a grouped tab did not produce blank/new-tab (blank tabs: [${activatedBlankTabs.join(', ')})`,
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
