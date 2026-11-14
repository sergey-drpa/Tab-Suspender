/**
 * Tab Suspender — Issue #4 repro: Chrome update/relaunch + expanded groups
 *
 * Hypothesis: when Chrome updates and relaunches, session restore follows a
 * different path than a normal `--restore-last-session` restart. This may
 * corrupt or drop the `url=` query parameter of parked extension pages for
 * grouped tabs that were left expanded (not collapsed).
 *
 * The user confirmed that their groups were NOT collapsed, so this test leaves
 * groups expanded.
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
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-chrome-update');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT    = 3;
const TABS_PER_GROUP = 10;
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

async function closeBrowserGracefully(browser: Browser): Promise<void> {
  await sleep(500);
  await browser.close().catch(() => {});
}

function getSessionsDir(userDataDir: string): string {
  return path.join(userDataDir, 'Default', 'Sessions');
}

function listSessionFiles(userDataDir: string): string[] {
  const dir = getSessionsDir(userDataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('Session_') || f.startsWith('Tabs_'))
    .map(f => path.join(dir, f));
}

function setupPostUpdateRestore(userDataDir: string): void {
  const sessionsDir = getSessionsDir(userDataDir);
  if (!fs.existsSync(sessionsDir)) return;

  const files = fs.readdirSync(sessionsDir);

  // After a normal graceful close, Chrome leaves:
  //   Current Session / Current Tabs  (the session it will restore next)
  //   Last Session / Last Tabs          (previous backup)
  //
  // During a relaunch-for-update, Chrome may rename Current -> Last before
  // shutting down and then restore from Last after restart. We simulate that
  // by copying Current over Last so Chrome uses the latest session data even
  // without `--restore-last-session`.
  const currentSession = files.find(f => f.startsWith('Session_'));
  const currentTabs    = files.find(f => f.startsWith('Tabs_'));

  if (currentSession) {
    const src = path.join(sessionsDir, currentSession);
    const dst = path.join(sessionsDir, 'Last Session');
    fs.copyFileSync(src, dst);
    log(`  Copied ${currentSession} -> Last Session`);
  }
  if (currentTabs) {
    const src = path.join(sessionsDir, currentTabs);
    const dst = path.join(sessionsDir, 'Last Tabs');
    fs.copyFileSync(src, dst);
    log(`  Copied ${currentTabs} -> Last Tabs`);
  }
}

async function main(): Promise<void> {
  log('Tab Suspender — Chrome update/relaunch repro (expanded groups)');
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
  log('Browser launched');

  let getSWLogs: (() => Promise<string[]>) | null = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    getSWLogs = await installSWLogCapture(browser);

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

    runner.section(`Phase A — Create ${GROUP_COUNT} EXPANDED groups x ${TABS_PER_GROUP} tabs + ${EXTRA_UNGROUPED_TABS} ungrouped`);

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

      // Groups are intentionally left EXPANDED (no collapsed:true update).
      const groupId = await evalInSW<number>(browser, `(async () => {
        return await chrome.tabs.group({ tabIds: ${JSON.stringify(tabIdsForGroup)} });
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
  } finally {
    if (originalTimeout != null) await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    if (originalIgnoreSuspendGroupedTabs != null) await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    if (originalStartNormalTabsDiscarted != null) await setSetting(browser, 'startNormalTabsDiscarted', originalStartNormalTabsDiscarted).catch(() => {});

    await closeBrowserGracefully(browser);
    log('Browser closed for restart');
  }

  await sleep(1000);

  runner.section('Phase B — Simulate post-update session files');
  const sessionFiles = listSessionFiles(SESSION_DIR);
  log(`  Session files before setup: ${sessionFiles.map(f => path.basename(f)).join(', ')}`);
  runner.assert(sessionFiles.length > 0, 'session files exist after graceful close');

  setupPostUpdateRestore(SESSION_DIR);

  runner.section('Phase C — Restore after simulated update relaunch (no --restore-last-session)');
  const browser2 = await launchBrowser(SESSION_DIR, false);
  log('Browser relaunched after simulated update (no --restore-last-session)');

  let getSWLogs2: (() => Promise<string[]>) | null = null;

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    getSWLogs2 = await installSWLogCapture(browser2);

    await waitForExtensionInit(browser2);

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

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

    runner.assert(allGroupedTabs.length === TOTAL_GROUP_TABS, `all ${TOTAL_GROUP_TABS} grouped tabs restored (got ${allGroupedTabs.length})`);

    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));
    const corruptedParkTabs = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix2) && t.url.includes('url=about'));
    const parkTabs = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix2));

    if (blankTabs.length > 0) {
      log(`  >>> RESTORE PRODUCED BLANK GROUPED TABS: ${blankTabs.map(t => `${t.id}=${t.url}`).join(', ')} <<<`);
    }
    if (corruptedParkTabs.length > 0) {
      log(`  >>> CORRUPTED PARK URL TABS: ${corruptedParkTabs.map(t => `${t.id}=${t.url.slice(0, 80)}`).join(' | ')} <<<`);
    }

    runner.assert(blankTabs.length === 0, `no restored grouped tab is blank/new-tab (got ${blankTabs.length})`);
    runner.assert(corruptedParkTabs.length === 0, `no restored grouped tab has corrupted park url parameter (got ${corruptedParkTabs.length})`);

    // Phase D — activate one tab per group and check for blank page.
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

    runner.assert(activatedBlankTabs.length === 0, `activating a grouped tab did not produce blank/new-tab (blank tabs: [${activatedBlankTabs.join(', ')})`);
    runner.assert(activatedWrongUrls.length === 0, `activated grouped tabs kept expected URLs (unexpected: ${activatedWrongUrls.slice(0, 3).join(', ')})`);
  } finally {
    if (getSWLogs2) {
      const logs = await getSWLogs2();
      log(`  Service worker logs (${logs.length} lines):`);
      for (const line of logs) log(line);
    }
    await browser2.close().catch(() => {});
    log('Browser closed after restore verification');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
