/**
 * Tab Suspender — Tab Group Session Restore E2E Test (heavy load + CPU throttle)
 *
 * Reproduces issue #4 under heavy tab load with CPU throttling, which should
 * stress Chrome's session restore path. The hypothesis is that with enough
 * suspended/discarded tabs Chrome restores collapsed groups through a transient
 * about:blank state, and the extension loses the parkedUrl before park.html loads.
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-heavy');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT          = 4;
const TABS_PER_GROUP       = 15;
const TOTAL_GROUP_TABS     = GROUP_COUNT * TABS_PER_GROUP;
const EXTRA_UNGROUPED_TABS = 60;

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

async function closeBrowserGracefully(browser: Browser): Promise<void> {
  // Give Chrome a moment to flush its session state, then do a normal close.
  await sleep(500);
  await browser.close().catch(() => {});
}

async function main(): Promise<void> {
  log('Tab Suspender — Tab Group Session Restore (heavy load + CPU throttle)');
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

    // Slow down the renderer so Chrome's session restore is stressed.
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }).catch(() => {});
    log('  CPU throttling rate=6 applied');

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

    // Simulate a real session: explicitly discard grouped tabs before shutdown.
    // In the user's profile these tabs were likely already discarded by Chrome
    // memory management before the browser was closed.
    runner.section('Phase A-E — Discard grouped tabs before abrupt shutdown');
    log(`  Manually discarding ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      await discardTabById(browser, id).catch(() => {});
      await sleep(30);
    }
    await sleep(2000);

    const postDiscardTabs = await queryChromeTabs(browser);
    const discardedGroupTabs = postDiscardTabs.filter(t => allTabIds.includes(t.id) && t.discarded);
    log(`  Discarded ${discardedGroupTabs.length}/${allTabIds.length} grouped tabs`);

    // Snapshot grouped tab state before the abrupt kill.
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

    await closeBrowserGracefully(browser);
    log('Browser closed for restart');
  }

  // Give the OS time to release the profile lock.
  await sleep(1000);

  runner.section('Phase C — Restart with heavy-load session restore and inspect grouped tabs');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  const cdp2 = await browser2.target().createCDPSession();
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 6 }).catch(() => {});
  log('  CPU throttling rate=6 applied after restart');

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
    const nullParkedSnapshots: { atMs: number; nullCount: number; nullIds: number[]; blankIds: number[] }[] = [];
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
          const tab = chrome.tabs.get(id).catch(() => null);
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

    const parsedSnapshot = JSON.parse(tabInfoSnapshot) as Array<{ tabId: number; hasInfo: boolean; parkedUrl: string | null }>;
    const nullParkedUrlTabs = parsedSnapshot.filter(e => e.hasInfo && e.parkedUrl == null);
    runner.assert(
      nullParkedUrlTabs.length === 0,
      `all restored grouped tabs have non-null parkedUrl in TabInfo (null count=${nullParkedUrlTabs.length}, ids=[${nullParkedUrlTabs.map(e => e.tabId).join(', ')}])`,
    );

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

    runner.assert(
      allGroupedTabs.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs restored (got ${allGroupedTabs.length})`,
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

      const infosNow = await evalInSW<string>(browser2, 'JSON.stringify(tabManager.getTabInfosCopy())');
      const parsedInfos = JSON.parse(infosNow as unknown as string) as { [id: string]: { _parkedUrl: string | null } };
      const tabWithNullParkedUrl = tabsInGroup.find(t => {
        const info = parsedInfos[t.id];
        return info && info._parkedUrl == null;
      });
      const tabToActivate = (tabWithNullParkedUrl || tabsInGroup[0]).id;

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
