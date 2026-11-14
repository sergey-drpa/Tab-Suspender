/**
 * Tab Suspender — Tab Group Session Restore E2E Test (activate-then-discard cycle)
 *
 * Tests the hypothesis from issue #4 that grouped tabs become blank/new-tab pages
 * only after a full freeze-thaw-freeze cycle:
 *   1. create grouped tabs and suspend them,
 *   2. close and restore the session,
 *   3. activate one tab per group so it unsuspends and loads the real URL,
 *   4. suspend and discard those tabs again,
 *   5. close and restore the session a second time,
 *   6. check whether any grouped tab now has a blank/missing `url` parameter.
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
  unsuspendTabById,
  waitForTabToRestore,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-activate-discard-cycle');
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

async function closeBrowserGracefully(browser: any): Promise<void> {
  await sleep(500);
  await browser.close().catch(() => {});
}

async function main(): Promise<void> {
  log('Tab Suspender — Tab Group Session Restore (activate-then-discard cycle)');
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
        await chrome.tabGroups.update(groupId, { collapsed: true });
        return groupId;
      })()`);

      groupInfos.push({ groupId, tabIds: tabIdsForGroup });
      allTabIds.push(...tabIdsForGroup);
      log(`  Group ${g + 1}: id=${groupId} (collapsed), tabs=[${tabIdsForGroup.slice(0, 3).join(', ')}...]`);
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
        result.push({ tabId: id, hasInfo: info != null, parked: info ? info._parked : null, parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null });
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

    await closeBrowserGracefully(browser);
    log('Browser closed for first restart');
  }

  await sleep(1000);

  runner.section('Phase C — First restore and inspect grouped tabs');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore (cycle 1)');

  let getSWLogs: (() => Promise<string[]>) | null = null;
  const activatedTabIds: number[] = [];

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after first restart: ${extensionId2}`);

    getSWLogs = await installSWLogCapture(browser2);
    log('Installed SW log capture');

    await waitForExtensionInit(browser2);
    log('Extension initialized after first restart');

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    await sleep(6000);

    const allGroupedTabsAfterFirstRestore = await evalInSW<GroupedTab[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id, discarded: tab.discarded });
      }
      return result;
    })()`);

    log(`  Grouped tabs after first restore: ${allGroupedTabsAfterFirstRestore.length} total`);
    log(`    ${allGroupedTabsAfterFirstRestore.slice(0, 6).map(t => `id=${t.id} url=${t.url.slice(0, 50)} discarded=${t.discarded} groupId=${t.groupId}`).join(' | ')}${allGroupedTabsAfterFirstRestore.length > 6 ? ' ...' : ''}`);

    runner.assert(
      allGroupedTabsAfterFirstRestore.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs restored after first restart (got ${allGroupedTabsAfterFirstRestore.length})`,
    );

    const blankAfterFirstRestore = allGroupedTabsAfterFirstRestore.filter(t => blankUrls.has(t.url));
    runner.assert(
      blankAfterFirstRestore.length === 0,
      `no grouped tab is blank/new-tab after first restore (got ${blankAfterFirstRestore.length})`,
    );

    runner.section('Phase D — Activate one tab per group and let it load the real URL');
    const restoredGroups = await evalInSW<{ id: number; tabCount: number; collapsed: boolean }[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map(g => ({ id: g.id, tabCount: g.tabCount, collapsed: g.collapsed }));
    })()`);

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
      activatedTabIds.push(tabToActivate);
      log(`  Activating group ${gi + 1} (restored id=${groupIdAfterRestore}) tab ${tabToActivate} to unsuspend`);

      await evalInSW(browser2, `chrome.tabs.update(${tabToActivate}, { active: true })`);
      await sleep(300);
      await unsuspendTabById(browser2, tabToActivate);

      try {
        const restoredUrl = await waitForTabToRestore(browser2, tabToActivate, 20000);
        log(`    Tab ${tabToActivate} restored to ${restoredUrl.slice(0, 60)}`);
      } catch (e) {
        const tabState = await evalInSW<{ url: string; discarded: boolean } | null>(browser2, `(async () => {
          const tab = await chrome.tabs.get(${tabToActivate}).catch(() => null);
          return tab ? { url: tab.url || '', discarded: tab.discarded } : null;
        })()`);
        log(`    Tab ${tabToActivate} did not leave park page; current state: ${JSON.stringify(tabState)}`);
        runner.softAssert(false, `tab ${tabToActivate} did not unsuspend to real URL: ${tabState?.url || 'null'}`);
      }
    }

    runner.assert(
      activatedTabIds.length === GROUP_COUNT,
      `activated one tab per group (activated ${activatedTabIds.length}/${GROUP_COUNT})`,
    );

    const blankPage2 = await browser2.newPage();
    await blankPage2.goto('about:blank');
    await sleep(500);

    runner.section('Phase E — Re-suspend and discard the activated tabs');
    for (const id of activatedTabIds) {
      await suspendTabById(browser2, id);
      await sleep(100);
    }
    await sleep(2000);

    for (const id of activatedTabIds) {
      await discardTabById(browser2, id).catch(() => {});
      await sleep(50);
    }
    await sleep(3000);

    const postDiscardTabs = await queryChromeTabs(browser2);
    const reParkedTabs = postDiscardTabs.filter(t => activatedTabIds.includes(t.id) && t.url.startsWith(parkPrefix2));
    const discardedReParkedTabs = postDiscardTabs.filter(t => activatedTabIds.includes(t.id) && t.discarded);
    log(`  Re-parked ${reParkedTabs.length}/${activatedTabIds.length} activated tabs; discarded ${discardedReParkedTabs.length}/${activatedTabIds.length}`);

    const blankUrlParams: { tabId: number; url: string; param: string | null }[] = [];
    for (const t of reParkedTabs) {
      const param = await evalInSW<string | null>(browser2, `parseUrlParam(${JSON.stringify(t.url)}, 'url')`);
      if (!param || blankUrls.has(param) || param.startsWith('chrome://newtab')) {
        blankUrlParams.push({ tabId: t.id, url: t.url, param });
      }
    }
    log(`  Re-parked tabs with blank/missing url param: ${blankUrlParams.length}`);
    for (const e of blankUrlParams) log(`    tabId=${e.tabId} param=${e.param} url=${e.url.slice(0, 120)}`);

    runner.assert(
      blankUrlParams.length === 0,
      `no re-parked activated tab has blank/new-tab url parameter (got ${blankUrlParams.length})`,
    );

    await evalInSW(browser2, 'tabManager.setCommonLoopPeriodMs(1000)');
    await sleep(2500);
  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      log(`  Service worker logs after first restore cycle (${logs.length} lines):`);
      for (const line of logs) log(line);
    }
    await closeBrowserGracefully(browser2);
    log('Browser closed for second restart');
  }

  await sleep(1000);

  runner.section('Phase F — Second restore and check for blank grouped tabs');

  const browser3 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore (cycle 2)');

  let getSWLogs3: (() => Promise<string[]>) | null = null;

  try {
    const extensionId3 = await getExtensionId(browser3);
    log(`Extension ID after second restart: ${extensionId3}`);

    getSWLogs3 = await installSWLogCapture(browser3);
    log('Installed SW log capture');

    await waitForExtensionInit(browser3);
    log('Extension initialized after second restart');

    const parkPrefix3 = parkUrlPrefix(extensionId3);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    const nullParkedSnapshots: { atMs: number; nullCount: number; nullIds: number[]; blankIds: number[] }[] = [];
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      const snap = await evalInSW<string>(browser3, `(async () => {
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
            parkedUrl: info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null,
          };
        });
        return JSON.stringify({ at: Date.now(), count: tabIds.length, entries: result });
      })()`).catch(() => null);
      if (snap) {
        const parsed = JSON.parse(snap);
        nullParkedSnapshots.push({
          atMs: parsed.at,
          nullCount: parsed.entries.filter((e: any) => e.parkedUrl == null).length,
          nullIds: parsed.entries.filter((e: any) => e.parkedUrl == null).map((e: any) => e.tabId),
          blankIds: [],
        });
      }
      await sleep(200);
    }
    log('  Null parkedUrl summary: ' + JSON.stringify(nullParkedSnapshots, null, 2));

    const tabInfoSnapshot = await evalInSW<string>(browser3, `(async () => {
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
    log('  TabInfo snapshot after second restart:\n' + tabInfoSnapshot);

    const parsedSnapshot = JSON.parse(tabInfoSnapshot) as Array<{ tabId: number; hasInfo: boolean; parkedUrl: string | null }>;
    const nullParkedUrlTabs = parsedSnapshot.filter(e => e.hasInfo && e.parkedUrl == null);
    runner.assert(
      nullParkedUrlTabs.length === 0,
      `all restored grouped tabs have non-null parkedUrl in TabInfo after second restore (null count=${nullParkedUrlTabs.length}, ids=[${nullParkedUrlTabs.map(e => e.tabId).join(', ')}])`,
    );

    const allGroupedTabs = await evalInSW<GroupedTab[]>(browser3, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id, discarded: tab.discarded });
      }
      return result;
    })()`);

    log(`  Grouped tabs after second restore: ${allGroupedTabs.length} total`);
    log(`    ${allGroupedTabs.slice(0, 6).map(t => `id=${t.id} url=${t.url.slice(0, 50)} discarded=${t.discarded} groupId=${t.groupId}`).join(' | ')}${allGroupedTabs.length > 6 ? ' ...' : ''}`);

    runner.assert(
      allGroupedTabs.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs restored after second restore (got ${allGroupedTabs.length})`,
    );

    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(
      blankTabs.length === 0,
      `no restored grouped tab is blank/new-tab after second restore (got ${blankTabs.length}: ${blankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );

    const parkedTabs = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix3));
    const blankUrlParams: { tabId: number; url: string; param: string | null }[] = [];
    for (const t of parkedTabs) {
      const param = await evalInSW<string | null>(browser3, `parseUrlParam(${JSON.stringify(t.url)}, 'url')`);
      if (!param || blankUrls.has(param) || param.startsWith('chrome://newtab')) {
        blankUrlParams.push({ tabId: t.id, url: t.url, param });
      }
    }
    log(`  Parked grouped tabs with blank/missing url param: ${blankUrlParams.length}`);
    for (const e of blankUrlParams) log(`    tabId=${e.tabId} param=${e.param} url=${e.url.slice(0, 120)}`);

    runner.assert(
      blankUrlParams.length === 0,
      `no parked grouped tab has blank/new-tab url parameter after second restore (got ${blankUrlParams.length})`,
    );

    runner.section('Phase G — Activate one tab per group after second restore');
    const restoredGroups2 = await evalInSW<{ id: number; tabCount: number; collapsed: boolean }[]>(browser3, `(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map(g => ({ id: g.id, tabCount: g.tabCount, collapsed: g.collapsed }));
    })()`);

    const activatedBlankTabs: number[] = [];
    const activatedWrongUrls: string[] = [];

    for (let gi = 0; gi < restoredGroups2.length; gi++) {
      const groupIdAfterRestore = restoredGroups2[gi].id;
      const tabsInGroup = await evalInSW<{ id: number; url: string; title?: string }[]>(browser3, `(async () => {
        const tabs = await chrome.tabs.query({ groupId: ${groupIdAfterRestore} });
        return tabs.map(t => ({ id: t.id, url: t.url || '', title: t.title || '' }));
      })()`);

      if (tabsInGroup.length === 0) {
        runner.softAssert(false, `no tabs found in restored group ${groupIdAfterRestore}`);
        continue;
      }

      const infosNow = await evalInSW<string>(browser3, 'JSON.stringify(tabManager.getTabInfosCopy())');
      const parsedInfos = JSON.parse(infosNow as unknown as string) as { [id: string]: { _parkedUrl: string | null } };
      const tabWithNullParkedUrl = tabsInGroup.find(t => {
        const info = parsedInfos[t.id];
        return info && info._parkedUrl == null;
      });
      const tabToActivate = (tabWithNullParkedUrl || tabsInGroup[0]).id;

      log(`  Activating group ${gi + 1} (restored id=${groupIdAfterRestore}, collapsed=${restoredGroups2[gi].collapsed}) tab ${tabToActivate}`);
      await evalInSW(browser3, `chrome.tabs.update(${tabToActivate}, { active: true })`);
      await sleep(2500);

      const activatedTab = await evalInSW<{ url: string; title?: string } | null>(browser3, `(async () => {
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
      } else if (!activatedTab.url.startsWith(parkPrefix3) && !activatedTab.url.includes('example.com')) {
        activatedWrongUrls.push(activatedTab.url);
      }
    }

    runner.assert(
      activatedBlankTabs.length === 0,
      `activating a grouped tab after second restore did not produce blank/new-tab (blank tabs: [${activatedBlankTabs.join(', ')})`,
    );
    runner.assert(
      activatedWrongUrls.length === 0,
      `activated grouped tabs after second restore kept expected URLs (unexpected: ${activatedWrongUrls.slice(0, 3).join(', ')})`,
    );
  } finally {
    if (getSWLogs3) {
      const logs = await getSWLogs3();
      log(`  Service worker logs after second restore cycle (${logs.length} lines):`);
      for (const line of logs) log(line);
    }
    await browser3.close().catch(() => {});
    log('Browser closed after second restore verification');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
