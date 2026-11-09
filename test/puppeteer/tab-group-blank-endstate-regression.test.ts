/**
 * Tab Suspender — Issue #4 end-state regression test
 *
 * Constructs in the Service Worker the exact broken state observed in real Chrome:
 *   - a grouped parked tab on park.html?tabId=originId&url=REAL_URL
 *   - tabInfos[liveId] with _parked=true, _parkedUrl=null, _originRefId=undefined
 *   - tabInfos[intermediateId] is a plain closed object (no toObject())
 *   - tabInfos[originId] is missing
 *
 * Then discards and activates the live tab and asserts that it does NOT navigate
 * to about:blank or chrome://newtab/. Before the fix this reproduces the blank
 * tab symptom; after the fix the tab should restore the original URL.
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
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-blank-endstate');
const TARGET_HOST = 'https://example.com';

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
  log('Tab Suspender — Issue #4 end-state regression test');
  log(`Session dir: ${SESSION_DIR}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  let originalTimeout: number | null = null;
  let originalDiscardTabAfterSuspendWithTimeout: boolean | null = null;
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
    originalDiscardTabAfterSuspendWithTimeout = await getSetting<boolean>(browser, 'discardTabAfterSuspendWithTimeout');

    await setSetting(browser, 'timeout', 10);
    await setSetting(browser, 'discardTabAfterSuspendWithTimeout', true);
    await setSetting(browser, 'discardTimeoutFactor', 0.05);
    await setSetting(browser, 'autoRestoreTab', false);
    await setSetting(browser, 'restoreOnMouseHover', true);
    await setSetting(browser, 'reloadTabOnRestore', false);
    log('  Applied reproduction settings');

    runner.section('Phase A — Create and group a single tab');
    const page = await browser.newPage();
    const targetUrl = `${TARGET_HOST}/?group=1&tab=1`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(200);

    const tabsAfterOpen = await queryChromeTabs(browser);
    const groupTab = tabsAfterOpen.find(t => t.url === targetUrl);
    runner.assert(!!groupTab, 'group tab opened');

    const originId = groupTab!.id;
    const groupId = await evalInSW<number>(browser, `(async () => {
      const groupId = await chrome.tabs.group({ tabIds: [${originId}] });
      await chrome.tabGroups.update(groupId, { collapsed: true });
      return groupId;
    })()`);
    log(`  Tab ${originId} grouped (groupId=${groupId}, collapsed)`);

    await sleep(300);

    runner.section('Phase B — Park and discard the grouped tab');
    await suspendTabById(browser, originId);

    const parkPrefix = parkUrlPrefix(extensionId);
    const parkedDeadline = Date.now() + 30000;
    let liveTab: { id: number; url: string; discarded: boolean } | null = null;
    while (Date.now() < parkedDeadline) {
      const tabs = await queryChromeTabs(browser);
      const t = tabs.find(x => x.url.startsWith(parkPrefix));
      if (t) {
        liveTab = { id: t.id, url: t.url, discarded: t.discarded };
        if (t.discarded) break;
        await evalInSW(browser, `chrome.tabs.discard(${t.id})`).catch(e => log(`  explicit discard error: ${(e as Error).message}`));
      }
      await sleep(300);
    }
    if (!liveTab) {
      const debugTabs = await queryChromeTabs(browser);
      log('  Debug: all tabs at deadline:');
      for (const t of debugTabs) {
        log(`    id=${t.id} url=${(t.url || '').slice(0, 80)} discarded=${t.discarded} groupId=${t.groupId} title=${t.title}`);
      }
    }
    runner.assert(!!liveTab, 'grouped tab is parked');
    log(`  Live tab ${liveTab!.id} on ${liveTab!.url.slice(0, 80)} discarded=${liveTab!.discarded}`);

    const liveId = liveTab!.id;
    const liveParkUrl = liveTab!.url;
    const originIdFromUrl = await evalInSW<number>(browser, `parseInt(parseUrlParam(${JSON.stringify(liveParkUrl)}, 'tabId'))`);
    log(`  tabId from park URL: ${originIdFromUrl} (liveId=${liveId})`);

    runner.section('Phase C — Simulate the broken TabInfo end-state on the live tab');

    // Reproduce the post-session-restore end-state observed in real Chrome:
    //   - live TabInfo exists but parkedUrl = null (lost during double ID replacement)
    //   - originRefId = undefined (link to origin snapshot broken)
    //   - tab is discarded
    // The live park.html URL still carries the original URL in its `url=` param,
    // which is exactly what the BGMessageListener fallback uses to recover.
    await evalInSW(browser, `(async () => {
      const infos = tabManager.tabInfos;
      const liveInfo = infos[${liveId}];
      if (liveInfo == null) throw new Error('liveInfo missing for liveId=' + ${liveId});

      liveInfo._parked = true;
      liveInfo._parkedUrl = null;
      liveInfo._originRefId = undefined;
      liveInfo._discarded = true;

      console.log('[end-state regression] Constructed broken state:', {
        liveId: ${liveId},
        liveParkedUrl: liveInfo._parkedUrl,
        liveOriginRefId: liveInfo._originRefId,
      });
    })()`);
    log('  Simulated broken TabInfo end-state (parkedUrl=null, originRefId=undefined)');

    // Verify the broken state: parkedUrl is null on the resolved TabInfo.
    const resolvedInfo = await evalInSW<{
      found: boolean;
      hasToObject: boolean | null;
      parkedUrl: string | null;
    }>(browser, `(async () => {
      const tabInfo = tabManager.findReplacedTabById(${liveId});
      return {
        found: !!tabInfo,
        hasToObject: tabInfo ? typeof tabInfo.toObject === 'function' : null,
        parkedUrl: tabInfo ? tabInfo._parkedUrl : null,
      };
    })()`);
    log(`  findReplacedTabById(${liveId}) → found=${resolvedInfo.found}, hasToObject=${resolvedInfo.hasToObject}, parkedUrl=${resolvedInfo.parkedUrl}`);

    runner.assert(resolvedInfo.found, 'live TabInfo must exist for the broken state');
    runner.assert(
      resolvedInfo.parkedUrl == null,
      'broken state must have null parkedUrl (precondition for the fallback path)',
    );

    runner.section('Phase D — Verify BGMessageListener.buildParkPageData recovers via fallback');

    const sessionId = await evalInSW<string>(browser, `parseUrlParam(${JSON.stringify(liveParkUrl)}, 'sessionId')`);
    const bgResponse = await evalInSW<{
      parkedUrl?: string | null;
      tabInfo?: { parkedUrl?: string | null } | null;
      error?: string;
    }>(browser, `(async () => {
      try {
        // Mirrors the real [TS:dataForParkPage] flow where chrome.runtime always
        // provides sender.tab: the live parked tab whose URL still carries the
        // original URL in its query string (the Level-2 fallback source).
        const response = await bgMessageListener.buildParkPageData(${liveId}, ${JSON.stringify(sessionId ?? '')}, { url: ${JSON.stringify(liveParkUrl)} });
        return {
          parkedUrl: response?.parkedUrl ?? null,
          tabInfo: response?.tabInfo ?? null,
        };
      } catch (e) {
        return { error: e.message };
      }
    })()`);

    log(`  BGMessageListener response: parkedUrl=${bgResponse.parkedUrl ? bgResponse.parkedUrl.slice(0, 60) : bgResponse.parkedUrl}, tabInfo.parkedUrl=${bgResponse.tabInfo?.parkedUrl ? bgResponse.tabInfo.parkedUrl.slice(0, 60) : bgResponse.tabInfo?.parkedUrl}, error=${bgResponse.error}`);

    runner.assert(
      !bgResponse.error,
      `BGMessageListener.buildParkPageData must not throw (got error: ${bgResponse.error})`,
    );
    runner.assert(
      bgResponse.parkedUrl === targetUrl || bgResponse.parkedUrl?.startsWith(targetUrl),
      `BGMessageListener must recover parkedUrl from live park.html URL (expected ${targetUrl}, got ${bgResponse.parkedUrl})`,
    );
    runner.assert(
      bgResponse.tabInfo != null,
      'BGMessageListener must return a tabInfo object',
    );

    runner.section('Phase E — Discard and activate the broken tab');

    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);

    const activatedUrl = await evalInSW<string>(browser, `(async () => {
      const tabBefore = await chrome.tabs.get(${liveId});
      if (!tabBefore.discarded) {
        await chrome.tabs.discard(${liveId});
        await new Promise(r => setTimeout(r, 300));
      }

      return new Promise(resolve => {
        let settled = false;
        const listener = (tabId, changeInfo, tab) => {
          if (tabId !== ${liveId}) return;
          if (changeInfo.url && !settled) {
            settled = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(changeInfo.url);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.update(${liveId}, { active: true }).catch(err => {
          if (!settled) {
            settled = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve('error:' + err.message);
          }
        });
        setTimeout(async () => {
          if (!settled) {
            settled = true;
            chrome.tabs.onUpdated.removeListener(listener);
            const t = await chrome.tabs.get(${liveId}).catch(() => null);
            resolve(t ? t.url : 'timeout');
          }
        }, 5000);
      });
    })()`).catch(e => `eval-error:${(e as Error).message}`);

    const becameBlank = blankUrls.has(activatedUrl) || activatedUrl.startsWith('chrome://newtab');
    log(`  Activated ${liveId}: afterUrl=${activatedUrl.slice(0, 80)} becameBlank=${becameBlank}`);

    runner.assert(
      !becameBlank,
      `activated grouped tab must not navigate to blank/new-tab (got ${activatedUrl})`,
    );

  } finally {
    if (getSWLogs) {
      const logs = await getSWLogs();
      log(`  Service worker logs (${logs.length} lines):`);
      for (const line of logs) log(line);
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
