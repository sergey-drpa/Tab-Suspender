/**
 * Minimal reproduction of upstream Chrome grouped-tab restore bug.
 *
 * Based on finding that Puppeteer defeats the bug by default because it uses a
 * fresh profile and hidden args. This test:
 *   1. Launches a persistent profile with only essential args.
 *   2. Creates a grouped tab and navigates it to the extension's park.html URL.
 *   3. Waits so Chromium can write the session state files.
 *   4. SIGKILL the browser.
 *   5. Relaunches the same profile with --restore-last-session.
 *   6. Checks whether the grouped tab became about:blank / chrome://newtab.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer, { type Browser } from 'puppeteer';
import { sleep, log, EXTENSION_PATH, getBrowserPID } from './base/BrowserHelper.js';
import { getExtensionId, evalInSW, queryChromeTabs } from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = path.join(__dirname, 'test-session', '.test-session-chrome-bug-repro');
const TARGET_URL = 'https://example.com/?group=chromebug&tab=1';

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
    await browser.close().catch(() => {});
    return;
  }
  log(`  Sending SIGKILL to Chrome process ${pid}`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    log(`  SIGKILL failed: ${(e as Error).message}`);
    await browser.close().catch(() => {});
  }
  await sleep(2000);
}

async function launchWithProfile(profilePath: string, restoreSession = false): Promise<Browser> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension not built. Run 'npm run build'. Expected: ${EXTENSION_PATH}`);
  }

  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--disable-extensions-file-access-check',
    '--disable-extensions-http-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ];

  if (restoreSession) {
    args.push('--restore-last-session');
    args.push('--hide-crash-restore-bubble');
  }

  return puppeteer.launch({
    headless: false,
    userDataDir: profilePath,
    args,
    defaultViewport: null,
    enableExtensions: true,
  });
}

async function markProfileCrashed(profilePath: string): Promise<void> {
  const prefsPath = path.join(profilePath, 'Default', 'Preferences');
  let prefs: any = {};
  if (fs.existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    } catch {
      prefs = {};
    }
  }
  prefs.profile = prefs.profile || {};
  prefs.profile.exit_type = 'Crashed';
  prefs.profile.exited_cleanly = false;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  log(`  Marked profile as crashed in ${prefsPath}`);
}

async function main(): Promise<void> {
  log('Tab Suspender — Minimal Chrome grouped tab restore bug reproduction');
  log(`Profile: ${PROFILE_PATH}`);

  ensureTabGroupsPermission();

  const runner = createTestRunner();

  if (fs.existsSync(PROFILE_PATH)) fs.rmSync(PROFILE_PATH, { recursive: true });
  fs.mkdirSync(PROFILE_PATH, { recursive: true });

  runner.section('Phase 1 — Create grouped park.html tab and SIGKILL');

  const browser1 = await launchWithProfile(PROFILE_PATH, false);
  let groupTabId: number | null = null;
  let groupId: number | null = null;

  try {
    const extensionId = await getExtensionId(browser1);
    log(`Extension ID: ${extensionId}`);

    // Open a single tab and navigate to a real page first.
    const [page] = await browser1.pages();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(500);

    const tabs = await queryChromeTabs(browser1);
    const targetTab = tabs.find(t => t.url === TARGET_URL);
    runner.assert(!!targetTab, 'target tab opened');
    groupTabId = targetTab!.id;

    // Group the tab and collapse it.
    groupId = await evalInSW<number>(browser1, `(async () => {
      const gid = await chrome.tabs.group({ tabIds: [${groupTabId}] });
      await chrome.tabGroups.update(gid, { collapsed: true });
      return gid;
    })()`);
    log(`  Tab ${groupTabId} grouped (groupId=${groupId}, collapsed)`);

    await sleep(500);

    // Manually navigate the grouped tab to the extension park.html URL.
    const parkUrl = `chrome-extension://${extensionId}/park.html?tabId=${groupTabId}&title=${encodeURIComponent('Example Domain')}&url=${encodeURIComponent(TARGET_URL)}&sessionId=1234567890&icon=undefined`;
    await evalInSW(browser1, `chrome.tabs.update(${groupTabId}, { url: ${JSON.stringify(parkUrl)} })`);

    // Wait until the tab URL is actually park.html and then discard it.
    const parkedDeadline = Date.now() + 15000;
    let parked = false;
    while (Date.now() < parkedDeadline) {
      const currentTabs = await queryChromeTabs(browser1);
      const t = currentTabs.find(x => x.id === groupTabId);
      if (t && t.url.startsWith(`chrome-extension://${extensionId}/park.html`)) {
        parked = true;
        if (!t.discarded) {
          await evalInSW(browser1, `chrome.tabs.discard(${groupTabId})`).catch(() => {});
        }
        if ((await queryChromeTabs(browser1)).find(x => x.id === groupTabId)?.discarded) break;
      }
      await sleep(200);
    }
    runner.assert(parked, 'grouped tab is on park.html before kill');
    const preKillTab = (await queryChromeTabs(browser1)).find(t => t.id === groupTabId);
    log(`  Grouped tab ${groupTabId} on park.html discarded=${preKillTab?.discarded}`);

    // CRITICAL: give Chromium time to write the session state files.
    await sleep(5000);
    log('  Waited for Chromium to persist session state');
  } finally {
    await killBrowserAbruptly(browser1);
    log('Browser killed for restart');
  }

  runner.section('Phase 2 — Relaunch with --restore-last-session');

  markProfileCrashed(PROFILE_PATH);

  const browser2 = await launchWithProfile(PROFILE_PATH, true);

  try {
    // Wait for Chrome to finish native restore before inspecting.
    await sleep(6000);

    const extensionId2 = await getExtensionId(browser2);
    log(`Extension ID after restart: ${extensionId2}`);

    const allTabs = await queryChromeTabs(browser2);
    log(`  All tabs after restore: ${allTabs.length}`);
    for (const t of allTabs) {
      log(`    id=${t.id} url=${(t.url || '').slice(0, 80)} discarded=${t.discarded} groupId=${t.groupId} title=${t.title}`);
    }

    const groupedTabs = allTabs.filter(t => t.groupId !== -1);
    log(`  Tabs in any group after restore: ${groupedTabs.length}`);

    const blankUrls = new Set(['', 'about:blank', 'chrome://newtab/', 'about:newtab']);
    const blankGroupedTabs = groupedTabs.filter(t => blankUrls.has(t.url) || t.url.startsWith('chrome://newtab'));
    const parkedGroupedTabs = groupedTabs.filter(t => t.url.startsWith(`chrome-extension://${extensionId2}/park.html`));

    log(`  Grouped tabs that became blank/new-tab: ${blankGroupedTabs.length}`);
    log(`  Grouped tabs still on park.html: ${parkedGroupedTabs.length}`);

    runner.section('Phase 2a — Activate any grouped park.html tab to see if it goes blank');

    const activationResults: Array<{ tabId: number; beforeUrl: string; afterUrl: string; becameBlank: boolean }> = [];
    for (const candidate of parkedGroupedTabs) {
      const beforeUrl = candidate.url;
      if (!candidate.discarded) {
        await evalInSW(browser2, `chrome.tabs.discard(${candidate.id})`).catch(() => {});
        await sleep(300);
      }
      const afterUrl = await evalInSW<string>(browser2, `(async () => {
        return new Promise(resolve => {
          let settled = false;
          const listener = (tabId, changeInfo, tab) => {
            if (tabId !== ${candidate.id}) return;
            if (changeInfo.url && !settled) {
              settled = true;
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(changeInfo.url);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          chrome.tabs.update(${candidate.id}, { active: true }).catch(err => {
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
              const t = await chrome.tabs.get(${candidate.id}).catch(() => null);
              resolve(t ? t.url : 'timeout');
            }
          }, 5000);
        });
      })()`).catch(e => `eval-error:${(e as Error).message}`);
      const becameBlank = blankUrls.has(afterUrl) || afterUrl.startsWith('chrome://newtab');
      activationResults.push({ tabId: candidate.id, beforeUrl, afterUrl, becameBlank });
      log(`    Activated ${candidate.id}: before=${beforeUrl.slice(0, 50)} after=${afterUrl.slice(0, 50)} blank=${becameBlank}`);
    }

    const activatedBlank = activationResults.filter(r => r.becameBlank);
    log(`  Activation blank count: ${activatedBlank.length}`);

    // For debugging, this test currently only logs. A failing assertion can be added once
    // a stable reproduction is achieved.
    runner.softAssert(
      blankGroupedTabs.length > 0 || parkedGroupedTabs.length > 0,
      'restore produced either blank grouped tabs or grouped tabs on park.html',
    );

  } finally {
    await browser2.close().catch(() => {});
    log('Browser closed after restore observation');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
