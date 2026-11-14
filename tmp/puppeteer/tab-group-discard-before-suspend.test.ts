/**
 * Tab Suspender — Repro: discard grouped tabs before suspending
 *
 * Hypothesis: if a grouped tab is discarded while Chrome still has it on a
 * placeholder about:blank URL, calling parkTab() on the discarded tab uses
 * that placeholder URL and parks it as url=about:blank.
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-discard-before-suspend');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT = 3;
const TABS_PER_GROUP = 10;
const TOTAL_GROUP_TABS = GROUP_COUNT * TABS_PER_GROUP;

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
  log('Tab Suspender — Discard before suspend repro');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();
  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let getSWLogs: (() => Promise<string[]>) | null = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    getSWLogs = await installSWLogCapture(browser);

    await waitForExtensionInit(browser);

    const originalTimeout = await getSetting<number>(browser, 'timeout');
    const originalIgnoreSuspendGroupedTabs = await getSetting<boolean>(browser, 'ignoreSuspendGroupedTabs');

    await setSetting(browser, 'timeout', 3600);
    await setSetting(browser, 'ignoreSuspendGroupedTabs', false);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', false);
    await setSetting(browser, 'startDiscarted', false);
    await setSetting(browser, 'startNormalTabsDiscarted', false);
    await setSetting(browser, 'autoRestoreTab', false);

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

    await sleep(500);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const groupTabs = tabsAfterOpen.filter(t => t.url && t.url.includes('example.com/?group='));
    runner.assert(groupTabs.length === TOTAL_GROUP_TABS, `all ${TOTAL_GROUP_TABS} group tabs opened`);

    for (let g = 0; g < GROUP_COUNT; g++) {
      const tabIdsForGroup = groupTabs
        .filter(t => t.url.includes(`group=${g + 1}&`))
        .map(t => t.id);
      const groupId = await evalInSW<number>(browser, `(async () => {
        const groupId = await chrome.tabs.group({ tabIds: ${JSON.stringify(tabIdsForGroup)} });
        await chrome.tabGroups.update(groupId, { collapsed: true });
        return groupId;
      })()`);
      allTabIds.push(...tabIdsForGroup);
      log(`  Group ${g + 1}: id=${groupId}, tabs=[${tabIdsForGroup.slice(0, 3).join(', ')}...]`);
    }

    runner.section('Phase A — Discard grouped tabs before parking');
    log(`  Discarding ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      const tabBefore = await evalInSW<{ url: string; discarded: boolean; status: string } | null>(browser, `(async () => {
        const t = await chrome.tabs.get(${id}).catch(() => null);
        return t ? { url: t.url, discarded: t.discarded, status: t.status } : null;
      })()`);
      log(`    Before discard ${id}: ${JSON.stringify(tabBefore)}`);
      await discardTabById(browser, id).catch(() => {});
      await sleep(50);
      const tabAfter = await evalInSW<{ url: string; discarded: boolean; status: string } | null>(browser, `(async () => {
        const t = await chrome.tabs.get(${id}).catch(() => null);
        return t ? { url: t.url, discarded: t.discarded, status: t.status } : null;
      })()`);
      log(`    After discard ${id}: ${JSON.stringify(tabAfter)}`);
    }
    await sleep(1000);

    runner.section('Phase B — Suspend discarded grouped tabs and inspect parked URLs');
    log(`  Suspending ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      const tabBeforeSuspend = await evalInSW<{ url: string; discarded: boolean } | null>(browser, `(async () => {
        const t = await chrome.tabs.get(${id}).catch(() => null);
        return t ? { url: t.url, discarded: t.discarded } : null;
      })()`);
      log(`    Before suspend ${id}: ${JSON.stringify(tabBeforeSuspend)}`);
      await suspendTabById(browser, id);
      await sleep(100);
    }
    await sleep(2000);

    const parkPrefix = parkUrlPrefix(extensionId);
    const parkedTabs = await queryChromeTabs(browser);
    const groupedParkedTabs = parkedTabs.filter(t => allTabIds.includes(t.id) && t.url.startsWith(parkPrefix));
    log(`  Parked grouped tabs: ${groupedParkedTabs.length}/${TOTAL_GROUP_TABS}`);

    const blankUrlParams: { tabId: number; url: string; param: string | null }[] = [];
    for (const t of groupedParkedTabs) {
      const param = await evalInSW<string | null>(browser, `parseUrlParam(${JSON.stringify(t.url)}, 'url')`);
      if (!param || param === 'about:blank' || param === 'about:newtab' || param.startsWith('chrome://newtab')) {
        blankUrlParams.push({ tabId: t.id, url: t.url, param });
      }
    }

    log(`  Grouped parked tabs with blank/missing url param: ${blankUrlParams.length}`);
    for (const e of blankUrlParams) log(`    tabId=${e.tabId} param=${e.param} url=${e.url.slice(0, 120)}`);

    runner.assert(
      groupedParkedTabs.length === TOTAL_GROUP_TABS,
      `all ${TOTAL_GROUP_TABS} grouped tabs parked after discard (got ${groupedParkedTabs.length})`,
    );
    runner.assert(
      blankUrlParams.length === 0,
      `no grouped parked tab has blank/new-tab url parameter (got ${blankUrlParams.length})`,
    );
  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      log(`  Service worker logs (${logs.length} lines):`);
      for (const line of logs) log(line);
    }
    await browser.close().catch(() => {});
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
