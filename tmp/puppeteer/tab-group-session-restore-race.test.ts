/**
 * Tab Suspender — Tab Group Session Restore Race Repro
 *
 * Hypothesis: Chrome restores grouped tabs through a transient state where
 * tab.url is about:blank/chrome://newtab/ before settling on park.html. During
 * that window, TabManager.onUpdated clears parkedUrl. If the user (or this test)
 * activates the tab exactly in that window, unsuspendTab navigates to
 * parseUrlParam(tab.url, 'url') which is null/empty → blank/new-tab page.
 *
 * This test aggressively polls grouped tabs immediately after relaunch and
 * activates them as soon as any non-park URL is observed.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-race');
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
  log('Tab Suspender — Tab Group Session Restore (race repro)');
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

  runner.section('Phase C — Relaunch and race-activate grouped tabs during restore');

  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    // Do NOT wait for extension init. Immediately start polling grouped tabs.
    // As soon as a grouped tab is observed with a non-park URL, activate it.
    const raceStart = Date.now();
    const raceDeadline = raceStart + 15000;
    const activatedTabs: { tabId: number; observedUrl: string; activatedAtMs: number }[] = [];
    let activatedBlankCount = 0;
    const activationLog: string[] = [];

    while (Date.now() < raceDeadline) {
      const groups = await evalInSW<{ id: number; tabCount: number }[]>(browser2, `(async () => {
        const groups = await chrome.tabGroups.query({});
        return groups.map(g => ({ id: g.id, tabCount: g.tabCount }));
      })()`).catch(() => []);

      for (const group of groups) {
        const tabs = await evalInSW<{ id: number; url: string; status?: string; discarded?: boolean }[]>(browser2, `(async () => {
          const tabs = await chrome.tabs.query({ groupId: ${group.id} });
          return tabs.map(t => ({ id: t.id, url: t.url || '', status: t.status, discarded: t.discarded }));
        })()`).catch(() => []);

        for (const tab of tabs) {
          if (activatedTabs.some(a => a.tabId === tab.id)) continue;

          // Activate on any non-park URL or on about:blank/newtab (the transient state).
          const isTransient = blankUrls.has(tab.url) || tab.url === 'about:blank';
          if (!tab.url.startsWith(parkPrefix2) || isTransient) {
            log(`  Race activation candidate: group=${group.id} tab=${tab.id} url="${tab.url}" status=${tab.status} discarded=${tab.discarded} atMs=${Date.now() - raceStart}`);
            await evalInSW(browser2, `chrome.tabs.update(${tab.id}, { active: true })`).catch(() => {});
            activatedTabs.push({ tabId: tab.id, observedUrl: tab.url, activatedAtMs: Date.now() - raceStart });
            await sleep(800); // let navigation settle

            const finalTab = await evalInSW<{ url: string; title?: string } | null>(browser2, `(async () => {
              const t = await chrome.tabs.get(${tab.id}).catch(() => null);
              return t ? { url: t.url || '', title: t.title || '' } : null;
            })()`);

            const line = `    Activated group=${group.id} tab=${tab.id} observed="${tab.url}" final="${finalTab?.url || 'GONE'}" title="${finalTab?.title || ''}" atMs=${Date.now() - raceStart}`;
            activationLog.push(line);
            log(line);

            if (finalTab && blankUrls.has(finalTab.url)) {
              activatedBlankCount++;
              log('  >>> RACE ACTIVATION PRODUCED BLANK TAB <<<');
            }
          }
        }
      }

      if (activatedTabs.length >= TOTAL_GROUP_TABS) break;
      await sleep(100);
    }

    log(`  Race activation summary: ${activatedTabs.length}/${TOTAL_GROUP_TABS} grouped tabs activated, blank=${activatedBlankCount}`);
    for (const line of activationLog) log(line);

    // Also wait for extension init and then check final state.
    await waitForExtensionInit(browser2).catch(() => {});
    await sleep(3000);

    const finalGroupedTabs = await evalInSW<{ id: number; url: string; groupId: number }[]>(browser2, `(async () => {
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
      `no final grouped tab is blank/new-tab (got ${finalBlankTabs.length}: ${finalBlankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );

    runner.softAssert(
      activatedBlankCount === 0,
      `race activation did not produce blank tabs (produced ${activatedBlankCount})`,
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
