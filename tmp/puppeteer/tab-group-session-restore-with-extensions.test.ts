/**
 * Tab Suspender — Issue #4 repro with real user extensions installed
 *
 * Runs Tab Suspender alongside the user's actual installed extensions:
 *   - AdBlock Plus (cfhdojbkjhnklbpkdaibdccddilifddb)
 *   - Awesome Screen Recorder & Screenshot (nlipoenfbbikpbjkfpfillcgkoblgpmj)
 *
 * Hypothesis: another extension with tabs/scripting permissions interferes
 * during session restore and causes grouped parked tabs to become blank.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer, { type Browser } from 'puppeteer';
import { sleep, log, EXTENSION_PATH } from './base/BrowserHelper.js';
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-group-restore-with-extensions');
const TARGET_HOST = 'https://example.com';

const GROUP_COUNT    = 3;
const TABS_PER_GROUP = 10;
const TOTAL_GROUP_TABS = GROUP_COUNT * TABS_PER_GROUP;
const EXTRA_UNGROUPED_TABS = 30;

const USER_EXTENSIONS_ROOT = path.resolve(
  '/Users/sergey/Library/Application Support/Google/Chrome/Default/Extensions',
);

const AD_BLOCK_ID     = 'cfhdojbkjhnklbpkdaibdccddilifddb';
const AWESOME_SS_ID   = 'nlipoenfbbikpbjkfpfillcgkoblgpmj';

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

function findExtensionDir(extensionId: string): string | null {
  const extDir = path.join(USER_EXTENSIONS_ROOT, extensionId);
  if (!fs.existsSync(extDir)) return null;
  const versions = fs.readdirSync(extDir).filter(d => fs.statSync(path.join(extDir, d)).isDirectory());
  if (versions.length === 0) return null;
  // Use the newest version folder (alphanumerically usually sorts correctly for semver-ish names)
  versions.sort();
  return path.join(extDir, versions[versions.length - 1]);
}

function copyExtensionToTemp(extensionId: string, destName: string): string {
  const src = findExtensionDir(extensionId);
  if (!src) throw new Error(`Could not find installed extension ${extensionId}`);
  const dest = path.join(SESSION_DIR, 'extensions', destName);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });

  function copyRecursive(srcDir: string, dstDir: string): void {
    for (const entry of fs.readdirSync(srcDir)) {
      const srcPath = path.join(srcDir, entry);
      const dstPath = path.join(dstDir, entry);
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        copyRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
  copyRecursive(src, dest);
  log(`Copied ${extensionId} from ${src} to ${dest}`);
  return dest;
}

async function launchBrowserWithExtensions(
  userDataDir: string,
  extensionPaths: string[],
  restoreSession = false,
): Promise<Browser> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension not built. Run 'npm run build' in project root.\nExpected: ${EXTENSION_PATH}`);
  }

  const allExtensionPaths = [EXTENSION_PATH, ...extensionPaths];
  const args = [
    `--disable-extensions-except=${allExtensionPaths.join(',')}`,
    `--load-extension=${allExtensionPaths.join(',')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-sync',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ];

  if (restoreSession) {
    args.push('--restore-last-session');
  }

  return puppeteer.launch({
    headless: false,
    userDataDir,
    args,
    defaultViewport: null,
  });
}

async function closeBrowserGracefully(browser: Browser): Promise<void> {
  await sleep(500);
  await browser.close().catch(() => {});
}

async function main(): Promise<void> {
  log('Tab Suspender — Group restore repro with user extensions');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();
  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const adBlockDir  = copyExtensionToTemp(AD_BLOCK_ID, 'adblock');
  const awesomeSsDir = copyExtensionToTemp(AWESOME_SS_ID, 'awesome-screenshot');
  log(`Extensions staged: adblock=${adBlockDir}, awesome-screenshot=${awesomeSsDir}`);

  let originalTimeout: number | null = null;
  let originalIgnoreSuspendGroupedTabs: boolean | null = null;
  let originalStartNormalTabsDiscarted: boolean | null = null;
  const groupInfos: GroupInfo[] = [];

  const browser = await launchBrowserWithExtensions(SESSION_DIR, [adBlockDir, awesomeSsDir]);
  log('Browser launched with Tab Suspender + AdBlock Plus + Awesome Screenshot');

  let getSWLogs: (() => Promise<string[]>) | null = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Tab Suspender extension ID: ${extensionId}`);

    getSWLogs = await installSWLogCapture(browser);

    await waitForExtensionInit(browser);

    // Close any extension onboarding tabs from AdBlock/Awesome to avoid noise.
    const tabsBefore = await queryChromeTabs(browser);
    const onboardingTabs = tabsBefore.filter(
      t => t.url && (
        t.url.includes(AD_BLOCK_ID) ||
        t.url.includes(AWESOME_SS_ID) ||
        (t.url.startsWith('chrome-extension://') && !t.url.includes('park.html') && !t.url.includes(extensionId))
      ),
    );
    for (const et of onboardingTabs) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
    }
    await sleep(500);

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
  } finally {
    if (originalTimeout != null) await setSetting(browser, 'timeout', originalTimeout).catch(() => {});
    if (originalIgnoreSuspendGroupedTabs != null) await setSetting(browser, 'ignoreSuspendGroupedTabs', originalIgnoreSuspendGroupedTabs).catch(() => {});
    if (originalStartNormalTabsDiscarted != null) await setSetting(browser, 'startNormalTabsDiscarted', originalStartNormalTabsDiscarted).catch(() => {});

    await closeBrowserGracefully(browser);
    log('Browser closed for restart');
  }

  await sleep(1000);

  runner.section('Phase B — Restart with extensions and inspect grouped tabs');

  const browser2 = await launchBrowserWithExtensions(SESSION_DIR, [adBlockDir, awesomeSsDir], true);
  log('Browser relaunched with session restore and extensions');

  let getSWLogs2: (() => Promise<string[]>) | null = null;

  try {
    const extensionId2 = await getExtensionId(browser2);
    log(`Tab Suspender extension ID after restart: ${extensionId2}`);

    getSWLogs2 = await installSWLogCapture(browser2);

    await waitForExtensionInit(browser2);

    const parkPrefix2 = parkUrlPrefix(extensionId2);
    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    // Poll immediately after init to catch transient blank state.
    const snapshots: { atMs: number; nullParkedCount: number; blankTabCount: number }[] = [];
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
        const blankUrls = ['', 'about:blank', 'chrome://newtab/', 'about:newtab'];
        let nullParked = 0;
        let blankTabs = 0;
        const entries = tabIds.map(id => {
          const info = infos[id] || null;
          const tab = chrome.tabs.get(id).catch(() => null);
          const parkedUrl = info && info._parkedUrl ? info._parkedUrl.slice(0, 80) : info ? info._parkedUrl : null;
          if (parkedUrl == null) nullParked++;
          return { tabId: id, parkedUrl };
        });
        // Wait for tab gets to settle
        const tabs = await Promise.all(tabIds.map(id => chrome.tabs.get(id).catch(() => null)));
        for (const t of tabs) if (t && blankUrls.includes(t.url || '')) blankTabs++;
        return JSON.stringify({ at: Date.now(), count: tabIds.length, nullParked, blankTabs, entries });
      })()`).catch(() => null);
      if (snap) {
        const parsed = JSON.parse(snap);
        snapshots.push({ atMs: parsed.at, nullParkedCount: parsed.nullParked, blankTabCount: parsed.blankTabs });
        if (parsed.blankTabs > 0 || parsed.nullParked > 0) {
          log(`  Early snapshot at ${Date.now() - pollStart}ms: nullParked=${parsed.nullParked} blankTabs=${parsed.blankTabs}`);
        }
      }
      await sleep(200);
    }
    log('  Snapshot summary: ' + JSON.stringify(snapshots, null, 2));

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

    if (blankTabs.length > 0) {
      log(`  >>> RESTORE PRODUCED BLANK GROUPED TABS: ${blankTabs.map(t => `${t.id}=${t.url}`).join(', ')} <<<`);
    }
    if (corruptedParkTabs.length > 0) {
      log(`  >>> CORRUPTED PARK URL TABS: ${corruptedParkTabs.map(t => `${t.id}=${t.url.slice(0, 80)}`).join(' | ')} <<<`);
    }

    runner.assert(
      blankTabs.length === 0,
      `no restored grouped tab is blank/new-tab (got ${blankTabs.length}: ${blankTabs.map(t => t.url || '<empty>').join(', ')})`,
    );
    runner.assert(
      corruptedParkTabs.length === 0,
      `no restored grouped tab has corrupted park url parameter (got ${corruptedParkTabs.length})`,
    );

    // Phase C — activate one tab per group, as the user would do.
    runner.section('Phase C — Activate one tab per group and check for blank page');
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
    if (getSWLogs2) {
      const logs = await getSWLogs2();
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
