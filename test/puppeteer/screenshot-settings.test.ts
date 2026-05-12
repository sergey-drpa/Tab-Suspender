/**
 * Tab Suspender — Screenshot Settings E2E Test
 *
 * Covers test cases 4.5 and 4.6:
 *   4.5 — Screenshot is captured when a tab becomes active with status='complete'
 *         Verified via ScreenshotController.isScreenExist(tabId, null, cb)
 *   4.6 — screenshotsEnabled=false → park.html has no embedded screenshot img
 *
 * Run:
 *   cd test/puppeteer && npx tsx screenshot-settings.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  evalInSW,
  suspendTabById,
  queryChromeTabs,
  waitForParkPages,
  getParkPages,
  getSetting,
  setSetting,
  parkUrlPrefix,
  waitForExtensionInit,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-screenshots');
const TARGET_URL  = 'https://example.com/';

async function screenshotExists(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  tabId: number,
): Promise<number | null> {
  return evalInSW<number | null>(browser, `(async () => {
    return new Promise(resolve => {
      ScreenshotController.isScreenExist(${tabId}, null, resolve);
    });
  })()`);
}

async function main(): Promise<void> {
  log('Tab Suspender — Screenshot Settings');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    const origScreenshotsEnabled = await getSetting(browser, 'screenshotsEnabled');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Screenshot captured on tab activation (4.5)
    //  Open example.com, bring to front (activation), wait for capture.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Screenshot captured on tab activation (4.5)');

    await setSetting(browser, 'screenshotsEnabled', true);

    const page = await browser.newPage();

    // Open tab in background first so it's inactive
    const blank = await browser.newPage();
    await blank.goto('about:blank');

    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    // page was opened but blank is still active; bring page to front to trigger capture
    await sleep(500);

    const tabs = await queryChromeTabs(browser);
    const targetTab = tabs.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetTab != null, 'example.com tab found');

    const tabId = targetTab!.id;

    // Activate — triggers tabCapture.captureTab via onActivated
    await page.bringToFront();
    log(`  Tab ${tabId} activated — waiting for screenshot capture...`);

    // Screenshot capture happens asynchronously after activation
    await sleep(4000);

    const screenCount = await screenshotExists(browser, tabId);
    log(`  ScreenshotController.isScreenExist(${tabId}) = ${screenCount}`);

    runner.assert(
      screenCount != null && Number(screenCount) > 0,
      `Screenshot captured for tab ${tabId} after activation (count: ${screenCount})`,
    );

    await blank.close().catch(() => {});
    await page.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — screenshotsEnabled=false → park.html has no screenshot (4.6)
    //  Suspend a tab with screenshots disabled.
    //  The park.html page should display title + favicon only, no screenshot img.
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — screenshotsEnabled=false → no screenshot on park.html (4.6)');

    await setSetting(browser, 'screenshotsEnabled', false);
    runner.assert(
      await getSetting(browser, 'screenshotsEnabled') === false,
      'screenshotsEnabled set to false',
    );

    const page2 = await browser.newPage();
    await page2.goto(TARGET_URL, { waitUntil: 'load', timeout: 20000 })
      .catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(1500);

    const tabs2 = await queryChromeTabs(browser);
    const targetTab2 = tabs2.find(t => t.url && t.url.includes('example.com'));
    runner.assert(targetTab2 != null, 'example.com tab found for phase B');

    const tabId2 = targetTab2!.id;

    const blank2 = await browser.newPage();
    await blank2.goto('about:blank');
    await sleep(300);

    await suspendTabById(browser, tabId2);
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  park.html appeared');

    const parkPages = await getParkPages(browser, extensionId);
    runner.assert(parkPages.length >= 1, 'park.html page found');

    const parkPage = parkPages[0];

    // park.html should NOT have the #screen img populated when screenshots disabled.
    // Other data:image elements (icons, restore button) are always present — we check #screen.
    const hasScreenshotImg = await parkPage.evaluate(() => {
      const screenEl = document.getElementById('screen') as HTMLImageElement | null;
      return screenEl != null && screenEl.src.startsWith('data:image') && screenEl.src.length > 500;
    });

    log(`  park.html has screenshot image: ${hasScreenshotImg}`);
    runner.assert(
      !hasScreenshotImg,
      'park.html does NOT show a screenshot image when screenshotsEnabled=false',
    );

    // Verify title and favicon ARE shown (basic fallback)
    const pageTitle = await parkPage.evaluate(() =>
      document.title || document.querySelector('#title')?.textContent || '',
    );
    log(`  park.html title: "${pageTitle}"`);
    runner.softAssert(pageTitle.length > 0, 'park.html shows a title when screenshot disabled');

    await blank2.close().catch(() => {});

    // ══════════════════════════════════════════════════════════════════════════
    //  TEARDOWN
    // ══════════════════════════════════════════════════════════════════════════
    await setSetting(browser, 'screenshotsEnabled', origScreenshotsEnabled ?? true);

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
