/**
 * Tab Suspender — Issue #4 native blank/new-tab reproduction E2E test
 *
 * Minimal reproduction of the real-Chrome causal chain:
 * 1. Group a few tabs and park them, but keep them NOT discarded before SIGKILL.
 * 2. SIGKILL Chrome and relaunch with session restore.
 * 3. After double tab-ID replacement, some grouped TabInfo entries have
 *    parkedUrl=null even though the live tab URL is still a valid park.html URL.
 * 4. Explicitly discard those tabs, then activate them.
 * 5. Because BGMessageListener cannot return a valid parkedUrl fallback,
 *    Chrome's discarded-tab reload can send the tab to chrome://newtab/.
 *
 * This test currently EXPECTS to reproduce the bug (i.e. it asserts that no blank
 * tab appears, so it should FAIL before the fix and PASS after the fix).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { type Browser } from 'puppeteer';
import { launchBrowser, sleep, log, EXTENSION_PATH, getBrowserPID, markProfileCrashed } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  queryChromeTabs,
  parkUrlPrefix,
  setSetting,
  getSetting,
  waitForExtensionInit,
  installSWLogCapture,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-blank-repro');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT     = 1;
const TABS_PER_GROUP  = 5;
const TOTAL_GROUP_TABS = GROUP_COUNT * TABS_PER_GROUP;

interface GroupedTab {
  id: number;
  url: string;
  groupId: number;
  discarded?: boolean;
}

interface TabInfoBrief {
  tabId: number;
  hasInfo: boolean;
  parked: boolean | null;
  parkedUrl: string | null;
  oldRefId: number | null;
  newRefId: number | null;
  originRefId: number | null;
  closed: { at: number; tsSessionId: number } | null;
  discarded: boolean | null;
  lstCapUrl: string | null;
  oldRefParkedUrl?: string | null;
  oldRefClosed?: { at: number; tsSessionId: number } | null;
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
  await sleep(2000);
}

async function getGroupedTabs(browser: Browser): Promise<GroupedTab[]> {
  return evalInSW<GroupedTab[]>(browser, `(async () => {
    const groups = await chrome.tabGroups.query({});
    const result = [];
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      for (const tab of tabs) result.push({ id: tab.id, url: tab.url || '', groupId: group.id, discarded: tab.discarded });
    }
    return result;
  })()`);
}

async function main(): Promise<void> {
  log('Tab Suspender — Issue #4 blank grouped tab native reproduction');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalStartDiscarted: boolean | null = null;
  let originalDiscardTabAfterSuspendWithTimeout: boolean | null = null;
  let originalStartNormalTabsDiscarted: boolean | null = null;
  const groupTabIds: number[] = [];

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
    originalStartDiscarted = await getSetting<boolean>(browser, 'startDiscarted');
    originalDiscardTabAfterSuspendWithTimeout = await getSetting<boolean>(browser, 'discardTabAfterSuspendWithTimeout');
    originalStartNormalTabsDiscarted = await getSetting<boolean>(browser, 'startNormalTabsDiscarted');

    const cfgPath = path.join(__dirname, 'data', 'TabSuspender-group-tab-crach-to-new-tab.cfg');
    const userSettings = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    for (const [key, value] of Object.entries(userSettings)) {
      if (key === 'timeout') continue;
      await setSetting(browser, key, value);
    }

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', true);
    await setSetting(browser, 'discardTimeoutFactor', 0.05);
    await setSetting(browser, 'startDiscarted', false);
    await setSetting(browser, 'startNormalTabsDiscarted', false);
    log('  Applied real-user settings (timeout=10s, auto-discard enabled with factor=0.05)');

    runner.section(`Phase A — Create ${TABS_PER_GROUP} grouped tabs`);

    for (let i = 0; i < TABS_PER_GROUP; i++) {
      const page = await browser.newPage();
      const url = `${TARGET_HOST}/?group=1&tab=${i + 1}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(e => log(`  nav note [t${i + 1}]: ${(e as Error).message}`));
      await sleep(20);
    }

    await sleep(500);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const groupTabs = tabsAfterOpen.filter(t => t.url && t.url.includes('example.com/?group=1&'));
    runner.assert(groupTabs.length === TABS_PER_GROUP, `all ${TABS_PER_GROUP} group tabs opened (got ${groupTabs.length})`);

    const tabIdsForGroup = groupTabs.map(t => t.id);
    const groupId = await evalInSW<number>(browser, `(async () => {
      const groupId = await chrome.tabs.group({ tabIds: ${JSON.stringify(tabIdsForGroup)} });
      await chrome.tabGroups.update(groupId, { collapsed: true });
      return groupId;
    })()`);
    groupTabIds.push(...tabIdsForGroup);
    log(`  Group 1: id=${groupId} (collapsed), tabs=[${tabIdsForGroup.join(', ')}]`);

    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(500);

    log(`  Suspending ${groupTabIds.length} grouped tabs...`);
    for (const id of groupTabIds) {
      await suspendTabById(browser, id);
      await sleep(50);
    }

    const parkPrefix = parkUrlPrefix(extensionId);
    log('  Waiting for all group tabs to be parked and discarded before restart...');
    const preRestartDeadline = Date.now() + 60000;
    let parkedCount = 0;
    let discardedCount = 0;
    while (Date.now() < preRestartDeadline) {
      const currentTabs = await queryChromeTabs(browser);
      parkedCount = currentTabs.filter(t => groupTabIds.includes(t.id) && t.url.startsWith(parkPrefix)).length;
      discardedCount = currentTabs.filter(t => groupTabIds.includes(t.id) && t.discarded).length;
      if (parkedCount === groupTabIds.length && discardedCount === groupTabIds.length) break;
      await sleep(500);
    }
    runner.assert(parkedCount === groupTabIds.length, `all ${groupTabIds.length} group tabs parked before restart (got ${parkedCount})`);
    runner.assert(discardedCount === groupTabIds.length, `all ${groupTabIds.length} group tabs discarded before restart (got ${discardedCount})`);

    // Wait for at least one tabInfos snapshot to be persisted with valid parkedUrl,
    // then simulate the race condition by clearing parkedUrl before the next snapshot.
    await sleep(12000);
    log('  Waited for tabInfos snapshot with valid parkedUrl');

    await evalInSW(browser, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const tabIds = [];
      for (const g of groups) {
        const tabs = await chrome.tabs.query({ groupId: g.id });
        for (const t of tabs) tabIds.push(t.id);
      }
      const infos = tabManager.tabInfos;
      for (const id of tabIds) {
        if (infos[id]) {
          infos[id]._parked = false;
          infos[id]._parkedUrl = null;
          infos[id]._lstCapUrl = '${TARGET_HOST}/?group=1&tab=' + (tabIds.indexOf(id) + 1);
        }
      }
      console.log('[blank repro] Cleared parkedUrl for grouped tabs:', tabIds);
    })()`);
    log('  Simulated stale snapshot: cleared parkedUrl for grouped tabs');

    await evalInSW(browser, 'tabManager.setCommonLoopPeriodMs(600000)');
    log('  Disabled tabInfos snapshot loop after clearing parkedUrl, before abrupt shutdown');
  } finally {
    await killBrowserAbruptly(browser);
    log('Browser killed for restart');
  }

  runner.section('Phase B — Prepare profile for SIGKILL session restore');
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

    // Let Chrome finish native session restore and group/tab-ID replacement
    // before the extension starts processing tabs.
    await sleep(5000);

    await waitForExtensionInit(browser2);
    log('Extension initialized after restart');

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    const allTabsAfterRestore = await queryChromeTabs(browser2);
    log(`  All tabs after restore: ${allTabsAfterRestore.length} total`);
    log(`    ${allTabsAfterRestore.map(t => `id=${t.id} url=${t.url.slice(0, 50)} discarded=${t.discarded}`).join(' | ')}`);

    const allGroupedTabs = await getGroupedTabs(browser2);
    log(`  Grouped tabs after restore: ${allGroupedTabs.length} total`);
    log(`    ${allGroupedTabs.map(t => `id=${t.id} url=${t.url.slice(0, 50)} discarded=${t.discarded}`).join(' | ')}`);

    const groupedParkedPostRestore = allGroupedTabs.filter(t => t.url.startsWith(parkPrefix2));
    runner.assert(groupedParkedPostRestore.length === TABS_PER_GROUP, `all ${TABS_PER_GROUP} grouped tabs are parked after SIGKILL restore (groupCount=${allGroupedTabs.length}, allTabs=${allTabsAfterRestore.length})`);

    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));
    runner.assert(blankTabs.length === 0, `no restored grouped tab is already blank/new-tab`);

    const tabInfoSnapshot = await evalInSW<TabInfoBrief[]>(browser2, `(async () => {
      const groups = await chrome.tabGroups.query({});
      const tabIds = [];
      for (const g of groups) {
        const tabs = await chrome.tabs.query({ groupId: g.id });
        for (const t of tabs) tabIds.push(t.id);
      }
      const infos = tabManager.getTabInfosCopy();
      return tabIds.map(id => {
        const info = infos[id] || null;
        const oldInfo = info && info._oldRefId != null ? (infos[info._oldRefId] || null) : null;
        return {
          tabId: id,
          hasInfo: info != null,
          parked: info ? info._parked : null,
          parkedUrl: info ? info._parkedUrl : null,
          oldRefId: info ? info._oldRefId : null,
          newRefId: info ? info._newRefId : null,
          originRefId: info ? info._originRefId : null,
          closed: info ? info._closed : null,
          discarded: info ? info._discarded : null,
          lstCapUrl: info ? info._lstCapUrl : null,
          oldRefParkedUrl: oldInfo ? oldInfo._parkedUrl : null,
          oldRefClosed: oldInfo ? oldInfo._closed : null,
        };
      });
    })()`);

    log('  TabInfo snapshot after restart:');
    for (const e of tabInfoSnapshot) {
      log(`    id=${e.tabId} parked=${e.parked} parkedUrl=${e.parkedUrl ? e.parkedUrl.slice(0, 60) : e.parkedUrl} oldRef=${e.oldRefId} originRef=${e.originRefId} closed=${!!e.closed} discarded=${e.discarded}`);
    }

    const nullParkedUrlTabs = tabInfoSnapshot.filter(e => e.hasInfo && e.parkedUrl == null);
    log(`  Grouped tabs with parkedUrl=null: ${nullParkedUrlTabs.length}`);
    for (const e of nullParkedUrlTabs) {
      log(`    liveId=${e.tabId} oldRefId=${e.oldRefId} originRefId=${e.originRefId} closed=${!!e.closed}`);
    }

    runner.softAssert(nullParkedUrlTabs.length > 0, 'reproduced stale TabInfo with parkedUrl=null');

    runner.section('Phase D — Discard and activate tabs with parkedUrl=null');

    const activationResults: Array<{ tabId: number; beforeUrl: string; afterUrl: string; becameBlank: boolean }> = [];

    for (const candidate of nullParkedUrlTabs) {
      const liveId = candidate.tabId;
      const beforeUrl = allGroupedTabs.find(t => t.id === liveId)?.url || '';

      if (!beforeUrl.startsWith(parkPrefix2)) {
        log(`  Skipping tab ${liveId}: not on park.html`);
        continue;
      }

      // Ensure the tab is discarded, then activate it.
      await evalInSW(browser2, `(async () => {
        const tab = await chrome.tabs.get(${liveId});
        if (!tab.discarded) {
          await chrome.tabs.discard(${liveId});
        }
      })()`).catch(e => log(`  discard error for ${liveId}: ${(e as Error).message}`));

      await sleep(300);

      // Activate the tab and capture the resulting URL.
      let activatedUrl = '';
      const updated = await evalInSW<string>(browser2, `(async () => {
        return new Promise((resolve) => {
          let settled = false;
          const listener = (tabId, changeInfo, tab) => {
            if (tabId !== ${liveId}) return;
            if (changeInfo.url) {
              if (!settled) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(changeInfo.url);
              }
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          chrome.tabs.update(${liveId}, { active: true }).catch(err => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve('error:' + err.message);
          });
          setTimeout(() => {
            if (!settled) {
              settled = true;
              chrome.tabs.onUpdated.removeListener(listener);
              chrome.tabs.get(${liveId}).then(t => resolve(t.url || 'empty')).catch(() => resolve('timeout'));
            }
          }, 3000);
        });
      })()`).catch(e => `eval-error:${(e as Error).message}`);

      activatedUrl = typeof updated === 'string' ? updated : String(updated);
      const becameBlank = blankUrls.has(activatedUrl) || activatedUrl.startsWith('chrome://newtab');
      activationResults.push({ tabId: liveId, beforeUrl, afterUrl: activatedUrl, becameBlank });
      log(`  Activated ${liveId}: before=${beforeUrl.slice(0, 60)} after=${activatedUrl.slice(0, 60)} blank=${becameBlank}`);

      // Try one more activation if it went blank, to see if it stays blank.
      if (becameBlank) {
        await sleep(500);
        const secondUrl = await evalInSW<string>(browser2, `(async () => {
          const tab = await chrome.tabs.get(${liveId});
          return tab.url || 'empty';
        })()`);
        log(`    Second check ${liveId}: ${secondUrl.slice(0, 60)}`);
      }
    }

    log('  Activation results:');
    for (const r of activationResults) {
      log(`    id=${r.tabId} blank=${r.becameBlank} after=${r.afterUrl}`);
    }

    const blankAfterActivation = activationResults.filter(r => r.becameBlank);
    runner.assert(
      blankAfterActivation.length === 0,
      `no grouped tab navigated to blank/new-tab after activation (got ${blankAfterActivation.length}: ${blankAfterActivation.map(r => r.tabId).join(', ')})`,
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
