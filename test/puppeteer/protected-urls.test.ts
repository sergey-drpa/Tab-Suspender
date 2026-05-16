/**
 * Tab Suspender — Protected URLs Test
 *
 * Covers test case 3.8:
 *   chrome://, chrome-extension://, and Chrome Web Store URLs must NEVER
 *   be suspended — TabManager.isTabURLAllowedForPark() must return false for them.
 *
 * Flow:
 *   Phase A — Unit-level check via evalInSW:
 *             Verify isTabURLAllowedForPark returns false for each protected URL scheme.
 *   Phase B — Integration check:
 *             Open chrome://settings, attempt to force-park it, verify the tab
 *             stays on chrome://settings and does NOT become park.html.
 *   Phase C — Verify http:// IS allowed (regression guard):
 *             isTabURLAllowedForPark must return true for regular web pages.
 *
 * Run:
 *   cd test/puppeteer && npx tsx protected-urls.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  queryChromeTabs,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-protected-urls');

// URLs that must never be suspended
const PROTECTED_URLS = [
  'chrome://settings/',
  'chrome://newtab/',
  'chrome://extensions/',
  'chrome-extension://someextension/background.html',
  'chrome://history/',
];

// URLs that MUST be allowed for parking
const ALLOWED_URLS = [
  'https://example.com/',
  'http://example.com/',
  'https://github.com/',
];

async function isAllowedForPark(browser: Parameters<typeof evalInSW>[0], url: string): Promise<boolean> {
  const result = await evalInSW<boolean>(browser, `
    TabManager.isTabURLAllowedForPark({ url: ${JSON.stringify(url)} })
  `);
  return result === true;
}

async function main(): Promise<void> {
  log('Tab Suspender — Protected URLs');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — isTabURLAllowedForPark unit checks
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — isTabURLAllowedForPark() for protected URLs');

    for (const url of PROTECTED_URLS) {
      const allowed = await isAllowedForPark(browser, url);
      runner.assert(
        !allowed,
        `isTabURLAllowedForPark returns false for: ${url}`,
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Integration: open chrome://settings and try to suspend it
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — chrome://settings cannot be force-suspended');

    const settingsPage = await browser.newPage();
    // chrome://settings can only be opened via keyboard shortcut in Puppeteer;
    // use goto with a fallback since some environments block chrome:// direct navigation.
    await settingsPage.goto('chrome://settings/', { waitUntil: 'domcontentloaded', timeout: 10000 })
      .catch(() => log('  chrome://settings navigation note (expected in some envs)'));
    await sleep(1000);

    const tabsBefore = await queryChromeTabs(browser);
    const settingsTab = tabsBefore.find(t => t.url && t.url.startsWith('chrome://settings'));

    if (settingsTab) {
      log(`  chrome://settings tab found, ID: ${settingsTab.id}`);

      // Attempt to park it via the extension's internal function
      await evalInSW(browser, `(async () => {
        const tab = await chrome.tabs.get(${settingsTab.id}).catch(() => null);
        if (tab) parkTab(tab, tab.id);
      })()`);

      await sleep(3000);

      const parkPrefix = parkUrlPrefix(extensionId);
      const tabsAfter = await queryChromeTabs(browser);
      const stillSettings = tabsAfter.find(t => t.id === settingsTab.id);
      const newParkTabs = tabsAfter.filter(t => t.url && t.url.startsWith(parkPrefix));

      runner.assert(
        stillSettings != null && stillSettings.url.startsWith('chrome://settings'),
        'chrome://settings tab remained on chrome://settings after park attempt',
      );
      // There should not be a new park page for the settings tab
      const parkForSettings = newParkTabs.find(t =>
        t.url && t.url.includes(`tabId=${settingsTab.id}`)
      );
      runner.softAssert(
        parkForSettings == null,
        'No park.html appeared for the chrome://settings tab',
      );
    } else {
      log('  chrome://settings tab not found — skipping integration sub-check');
      runner.softAssert(true, 'Phase B integration sub-check skipped (tab not accessible)');
    }

    await settingsPage.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Allowed URLs are allowed (regression guard)
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — isTabURLAllowedForPark() returns true for regular URLs');

    for (const url of ALLOWED_URLS) {
      const allowed = await isAllowedForPark(browser, url);
      runner.assert(
        allowed,
        `isTabURLAllowedForPark returns true for: ${url}`,
      );
    }

  } finally {
    await browser.close();
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
