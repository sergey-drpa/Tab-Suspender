/**
 * Tab Suspender — Issue #4 click-restore regression test
 *
 * Verifies the user-reported symptom fix: after Chrome session restore, a
 * grouped parked tab with a broken TabInfo (parkedUrl=null) must restore to
 * the ORIGINAL url when the user clicks/hovers the restore icon — not back to
 * park.html, and not to about:blank.
 *
 * Root cause of the user-visible symptom:
 *   1. After restart, tab history is short ([about:blank, park.html] or just
 *      [park.html]). park.ts goBack() used history.go(-1), which landed on
 *      about:blank instead of the original URL.
 *   2. The TabInfo.parkedUrl fallback was null (lost during double ID
 *      replacement), so BGMessageListener could not provide a fallback.
 *
 * Fix under test:
 *   - park.ts goBack(): only use historyFallback when window.history.length > 2;
 *     otherwise use window.location.replace(targetUrl) to navigate directly.
 *   - BGMessageListener.buildParkPageData: recover parkedUrl from the live
 *     park.html?url= query when persisted TabInfo.parkedUrl is null.
 *
 * Test flow:
 *   1. Open a real page, group it (collapsed), park it.
 *   2. Simulate the broken post-restart end-state on the live TabInfo:
 *      parkedUrl=null, originRefId=undefined.
 *   3. Trigger restore via hover on the restore icon.
 *   4. Assert the tab navigates to the original URL, not park.html/blank.
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
  waitForParkPages,
  getParkPages,
  waitForAnyTabToLeaveParked,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-blank-url-revert');
const TARGET_URL  = 'https://example.com/?group=1&tab=1';

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
  log('Tab Suspender — Issue #4 click-restore regression test');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let getSWLogs: (() => Promise<string[]>) | null = null;

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched (fresh profile)');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    getSWLogs = await installSWLogCapture(browser);
    log('Installed SW log capture');

    const tabsBefore = await queryChromeTabs(browser);
    const extensionTabs = tabsBefore.filter(
      t => t.url && t.url.startsWith(`chrome-extension://${extensionId}`) && !t.url.includes('park.html'),
    );
    for (const et of extensionTabs) {
      await evalInSW(browser, `chrome.tabs.remove(${et.id})`).catch(() => {});
    }
    await sleep(300);

    originalTimeout = await getSetting<number>(browser, 'timeout');
    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'reloadTabOnRestore', false);
    await setSetting(browser, 'restoreOnMouseHover', true);
    log('  Applied test settings');

    runner.section('Phase A — Open, group, and park a tab');
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(300);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const targetTab = tabsAfterOpen.find(t => t.url === TARGET_URL);
    runner.assert(!!targetTab, 'target tab opened');
    const tabId = targetTab!.id;

    const groupId = await evalInSW<number>(browser, `(async () => {
      const groupId = await chrome.tabs.group({ tabIds: [${tabId}] });
      await chrome.tabGroups.update(groupId, { collapsed: true });
      return groupId;
    })()`);
    log(`  Tab ${tabId} grouped (groupId=${groupId}, collapsed)`);

    await sleep(300);
    await suspendTabById(browser, tabId);

    const parkPrefix = parkUrlPrefix(extensionId);
    await waitForParkPages(browser, extensionId, 1, 20000);
    const parkedTabs = (await queryChromeTabs(browser)).filter(t => t.url?.startsWith(parkPrefix));
    runner.assert(parkedTabs.length >= 1, 'tab is parked on park.html');
    const liveTab = parkedTabs[0];
    const liveId = liveTab.id;
    runner.assert(
      liveTab.url!.includes(`url=${encodeURIComponent(TARGET_URL)}`),
      'park.html URL preserves original URL in url= param',
    );
    log(`  Parked tab liveId=${liveId}, url=${liveTab.url!.slice(0, 100)}...`);

    runner.section('Phase B — Simulate broken post-restart TabInfo end-state');
    await evalInSW(browser, `(async () => {
      const infos = tabManager.tabInfos;
      const liveInfo = infos[${liveId}];
      if (liveInfo == null) throw new Error('liveInfo missing for liveId=' + ${liveId});
      liveInfo._parked = true;
      liveInfo._parkedUrl = null;
      liveInfo._originRefId = undefined;
      console.log('[Issue #4 test] Constructed broken state: parkedUrl=null, originRefId=undefined');
    })()`);

    const resolvedParkedUrl = await evalInSW<string | null>(browser, `(async () => {
      const ti = tabManager.findReplacedTabById(${liveId});
      return ti ? ti._parkedUrl : null;
    })()`);
    runner.assert(
      resolvedParkedUrl == null,
      'broken state precondition: parkedUrl must be null',
    );
    log('  Broken state confirmed (parkedUrl=null)');

    runner.section('Phase C — Trigger restore via hover and verify navigation to original URL');

    const parkPages = await getParkPages(browser, extensionId);
    runner.assert(parkPages.length >= 1, `park page found (got ${parkPages.length})`);
    const parkPage = parkPages.find(p => p.url().includes(`tabId=${tabId}`)) ?? parkPages[0];
    log(`  park page url: ${parkPage.url().slice(0, 100)}...`);

    await parkPage.waitForSelector('#resoteImg', { visible: true, timeout: 10000 });
    await parkPage.waitForFunction(
      () => !!(document.getElementById('resoteImg') as HTMLImageElement | null)?.onmouseover,
      { timeout: 8000 },
    ).catch(async () => {
      const html = await parkPage.evaluate(() => document.body?.innerHTML?.slice(0, 300) ?? '');
      log(`  WARNING: onmouseover not set. body: ${html}`);
    });
    log('  #resoteImg onmouseover handler ready');

    await parkPage.evaluate(() => {
      document.getElementById('resoteImg')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }).catch((e: Error) => {
      if (!e.message.includes('Execution context was destroyed') &&
          !e.message.includes('Target closed')) {
        throw e;
      }
    });
    log('  Triggered mouseover on #resoteImg');

    const host = new URL(TARGET_URL).host;
    const restoredUrl = await waitForAnyTabToLeaveParked(browser, extensionId, host, 20000).catch(() => null);

    log(`  Restored url: ${restoredUrl ?? 'null'}`);
    runner.assert(
      restoredUrl != null && restoredUrl.includes(host),
      `tab must restore to original URL ${TARGET_URL} (got: ${restoredUrl})`,
    );
    runner.assert(
      restoredUrl != null && !restoredUrl.startsWith(parkPrefix),
      'tab must NOT remain on park.html after restore',
    );

    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);
    runner.assert(
      restoredUrl != null && !blankUrls.has(restoredUrl),
      'tab must NOT land on about:blank / chrome://newtab/',
    );

  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      const relevant = logs.filter(l => l.includes('Issue #4') || l.includes('Reverting') || l.includes('parked') || l.includes('goBack') || l.includes('Reload'));
      log(`  Relevant SW logs (${relevant.length} lines):`);
      for (const line of relevant.slice(-20)) log(line);
    }
    await browser.close().catch(() => {});
    log('Browser closed');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});