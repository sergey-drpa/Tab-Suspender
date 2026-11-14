/**
 * Tab Suspender — Session file corruption repro
 *
 * Hypothesis: Chrome's session restore can itself supply a corrupted
 * park.html URL (url=about:blank) if the saved Session/Tabs files were
 * corrupted before restore. This test synthetically corrupts one grouped
 * tab's parked URL in the saved session files, then restores and checks
 * whether the tab becomes blank.
 *
 * If this reproduces the symptom, the vulnerable code path (park.ts goBack)
 * is triggered by data that originates from Chrome's session store, not
 * from the extension's own logic.
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-corrupt-session-file');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT    = 3;
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

async function closeBrowserGracefully(browser: Browser): Promise<void> {
  await sleep(500);
  await browser.close().catch(() => {});
}

function findSessionFiles(userDataDir: string): string[] {
  const sessionsDir = path.join(userDataDir, 'Default', 'Sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  return fs.readdirSync(sessionsDir)
    .filter(f => f.startsWith('Session_') || f.startsWith('Tabs_'))
    .map(f => path.join(sessionsDir, f));
}

interface CorruptionResult {
  file: string;
  replacements: number;
}

function corruptParkUrlInSessionFiles(
  files: string[],
  originalUrlParam: string,
  targetTabIdHint?: number,
): CorruptionResult[] {
  const results: CorruptionResult[] = [];
  for (const file of files) {
    const original = fs.readFileSync(file);
    const text = original.toString('binary');

    // Find occurrences of park.html?...url=REAL_URL... for the target grouped tab.
    // We replace only the first occurrence to corrupt one tab.
    const search = `url=${encodeURIComponent(originalUrlParam)}`;
    const replace = `url=${encodeURIComponent('about:blank')}`;
    let replaced = text;
    let replacements = 0;

    if (replaced.includes(search)) {
      replaced = replaced.replace(search, replace);
      replacements = 1;
    }

    if (replacements > 0) {
      fs.writeFileSync(file, replaced, { encoding: 'binary' });
      results.push({ file, replacements });
    }
  }
  return results;
}

async function main(): Promise<void> {
  log('Tab Suspender — Session file corruption repro');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();
  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalIgnoreSuspendGroupedTabs: boolean | null = null;

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let getSWLogs: (() => Promise<string[]>) | null = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    getSWLogs = await installSWLogCapture(browser);

    await waitForExtensionInit(browser);

    originalTimeout = await getSetting<number>(browser, 'timeout');
    originalIgnoreSuspendGroupedTabs = await getSetting<boolean>(browser, 'ignoreSuspendGroupedTabs');

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'ignoreSuspendGroupedTabs', false);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', false);
    await setSetting(browser, 'startDiscarted', false);
    await setSetting(browser, 'startNormalTabsDiscarted', false);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'reloadTabOnRestore', false);

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
      log(`  Group ${g + 1}: id=${groupId}, tabs=[${tabIdsForGroup.slice(0, 3).join(', ')}...] target=${tabIdsForGroup[0]}`);
    }

    const targetTabId = allTabIds[0];
    const targetUrl = `${TARGET_HOST}/?group=1&tab=1`;

    log(`  Suspending ${allTabIds.length} grouped tabs...`);
    for (const id of allTabIds) {
      await suspendTabById(browser, id);
      await sleep(50);
    }

    const parkPrefix = parkUrlPrefix(extensionId);
    const deadline = Date.now() + 30000;
    let parkedCount = 0;
    while (Date.now() < deadline) {
      const currentTabs = await queryChromeTabs(browser);
      parkedCount = currentTabs.filter(t => t.url && t.url.startsWith(parkPrefix)).length;
      if (parkedCount === TOTAL_GROUP_TABS) break;
      await sleep(500);
    }
    runner.assert(parkedCount === TOTAL_GROUP_TABS, `all ${TOTAL_GROUP_TABS} group tabs parked (got ${parkedCount})`);

    const targetTabUrlBefore = (await queryChromeTabs(browser)).find(t => t.id === targetTabId)?.url ?? '';
    log(`  Target tab ${targetTabId} parked URL before close: ${targetTabUrlBefore.slice(0, 120)}`);
    runner.assert(targetTabUrlBefore.includes(`url=${encodeURIComponent(targetUrl)}`), 'target tab parked URL contains real url parameter');
  } finally {
    if (originalTimeout != null) await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    if (originalIgnoreSuspendGroupedTabs != null) await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    await closeBrowserGracefully(browser);
    log('Browser closed for session file corruption');
  }

  await sleep(1000);

  runner.section('Phase B — Corrupt saved session files');
  const sessionFiles = findSessionFiles(SESSION_DIR);
  log(`  Found ${sessionFiles.length} session files: ${sessionFiles.map(f => path.basename(f)).join(', ')}`);
  runner.assert(sessionFiles.length > 0, 'session files exist after graceful close');

  const corruptionResults = corruptParkUrlInSessionFiles(
    sessionFiles,
    `${TARGET_HOST}/?group=1&tab=1`,
  );
  const totalReplacements = corruptionResults.reduce((sum, r) => sum + r.replacements, 0);
  log(`  Corrupted ${totalReplacements} occurrence(s) across ${corruptionResults.length} file(s)`);
  for (const r of corruptionResults) log(`    ${path.basename(r.file)}: ${r.replacements}`);
  runner.assert(totalReplacements > 0, 'successfully corrupted target url in at least one session file');

  runner.section('Phase C — Restore and verify grouped tabs');
  const browser2 = await launchBrowser(SESSION_DIR, true);
  log('Browser relaunched with session restore');

  let getSWLogs2: (() => Promise<string[]>) | null = null;

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    getSWLogs2 = await installSWLogCapture(browser2);

    await waitForExtensionInit(browser2);

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    const allGroupedTabs = await evalInSW<{ id: number; url: string; groupId: number; discarded?: boolean }[]>(browser2, `(async () => {
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

    const corruptedTab = allGroupedTabs.find(t => t.url.startsWith(parkPrefix2) && t.url.includes('url=about%3Ablank'));
    const blankTabs = allGroupedTabs.filter(t => blankUrls.has(t.url));

    if (corruptedTab) {
      log(`  >>> FOUND TAB WITH CORRUPTED PARK URL: id=${corruptedTab.id} url=${corruptedTab.url.slice(0, 120)} <<<`);
    }
    if (blankTabs.length > 0) {
      log(`  >>> RESTORE PRODUCED BLANK TABS: ${blankTabs.map(t => t.id).join(', ')} <<<`);
    }

    runner.assert(
      corruptedTab != null,
      'restored at least one grouped tab with corrupted park.html url=about:blank, confirming session data propagates corruption',
    );

    // Activate the corrupted tab and check final navigation.
    if (corruptedTab) {
      await evalInSW(browser2, `chrome.tabs.update(${corruptedTab.id}, { active: true })`);
      await sleep(2500);
      const activatedTab = await evalInSW<{ url: string; title?: string } | null>(browser2, `(async () => {
        const tab = await chrome.tabs.get(${corruptedTab.id}).catch(() => null);
        return tab ? { url: tab.url || '', title: tab.title || '' } : null;
      })()`);
      if (activatedTab) {
        log(`    Activated corrupted tab: url=${activatedTab.url.slice(0, 60)} title="${activatedTab.title}"`);
        if (blankUrls.has(activatedTab.url)) {
          log('  >>> ACTIVATION OF CORRUPTED TAB PRODUCED BLANK PAGE <<<');
        }
      }
    }
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
