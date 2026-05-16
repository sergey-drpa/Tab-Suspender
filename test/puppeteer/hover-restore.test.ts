/**
 * Tab Suspender — Hover Restore E2E Test
 *
 * Covers test case 2.6:
 *   2.6 — When restoreOnMouseHover=true, hovering over the restore icon on park.html
 *         triggers navigation back to the original URL (no click required).
 *
 * Mechanism in park.ts:
 *   - getRestoreEvent() returns 'hover' when restoreOnMouseHover=true (default)
 *   - park.ts line 287: resroreImg.onmouseover = () => { if (restoreEvent === 'hover') { goBack(); } }
 *   - The restore icon DOM id is 'resoteImg' (intentional typo in original code)
 *
 * Run:
 *   cd test/puppeteer && npx tsx hover-restore.test.ts
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  suspendTabById,
  waitForParkPages,
  getParkPages,
  queryChromeTabs,
  getSetting,
  setSetting,
  waitForAnyTabToLeaveParked,
  waitForExtensionInit,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-hover-restore');

function startHttpServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Hover Restore Test</title></head><body>Hover Restore Test Page</body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
    server.on('error', reject);
  });
}

async function main(): Promise<void> {
  log('Tab Suspender — Hover Restore (test case 2.6)');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { server, url: testUrl } = await startHttpServer();
  log(`HTTP server: ${testUrl}`);

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  let originalHoverSetting: unknown = null;

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    await waitForExtensionInit(browser);

    originalHoverSetting = await getSetting(browser, 'restoreOnMouseHover');
    log(`  restoreOnMouseHover default: ${originalHoverSetting}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Ensure restoreOnMouseHover=true and verify hover restores tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — restoreOnMouseHover=true: hover triggers restore');

    await setSetting(browser, 'restoreOnMouseHover', true);
    runner.assert(
      await getSetting(browser, 'restoreOnMouseHover') === true,
      'restoreOnMouseHover set to true',
    );

    // Open the test page
    const targetPage = await browser.newPage();
    await targetPage.goto(testUrl, { waitUntil: 'load', timeout: 10000 });
    await sleep(1000);

    const tabs = await queryChromeTabs(browser);
    const targetTab = tabs.find(t => t.url && t.url.startsWith('http://127.0.0.1'));
    runner.assert(targetTab != null, 'target tab opened');

    // Focus away so target tab becomes inactive
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(300);

    log(`  Suspending tab ${targetTab!.id}...`);
    await suspendTabById(browser, targetTab!.id);
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  park.html appeared');

    // Get the puppeteer Page object for the park page
    const parkPages = await getParkPages(browser, extensionId);
    runner.assert(parkPages.length >= 1, `at least one park page found (got ${parkPages.length})`);

    const parkPage = parkPages[0];
    log(`  park page URL: ${parkPage.url().slice(0, 80)}`);

    // Wait for the restore icon to be visible AND for its onmouseover handler to be registered.
    // The element (#resoteImg, note typo in source) becomes visible at DOMContentLoaded, but
    // the onmouseover handler is wired up later inside applyRestoreButtonView() which is called
    // from drawContent() after the screenshot promise settles (up to 2.5s timeout).
    log('  Waiting for #resoteImg onmouseover handler...');
    await parkPage.waitForSelector('#resoteImg', { visible: true, timeout: 10000 });
    await parkPage.waitForFunction(
      () => !!(document.getElementById('resoteImg') as HTMLImageElement | null)?.onmouseover,
      { timeout: 8000 },
    ).catch(async () => {
      const html = await parkPage.evaluate(() => document.body?.innerHTML?.slice(0, 500) ?? '');
      log(`  WARNING: onmouseover not set after 8s. park page body: ${html}`);
    });
    log('  #resoteImg handler ready');

    // Trigger the onmouseover handler. Puppeteer's hover() moves the mouse via CDP but may
    // not reliably fire onmouseover on extension pages. Dispatching the MouseEvent directly
    // is more reliable and matches what the user would actually do.
    // After goBack() runs, the page navigates away — the evaluate() call will throw
    // "Execution context was destroyed", which is expected and should be ignored.
    log('  Triggering mouseover on #resoteImg...');
    await parkPage.evaluate(() => {
      document.getElementById('resoteImg')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }).catch((e: Error) => {
      if (!e.message.includes('Execution context was destroyed') &&
          !e.message.includes('Target closed')) {
        throw e;
      }
    });

    // Wait for any tab to leave the park URL and land on our test server
    const restoredUrl = await waitForAnyTabToLeaveParked(browser, extensionId, '127.0.0.1', 20000)
      .catch(() => null);

    runner.assert(
      restoredUrl != null && restoredUrl.includes('127.0.0.1'),
      `Tab restored to original URL via hover (got: ${restoredUrl})`,
    );

    await blankPage.close().catch(() => {});

    await sleep(500);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — restoreOnMouseHover=false: hover should NOT restore tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — restoreOnMouseHover=false: hover does not restore');

    await setSetting(browser, 'restoreOnMouseHover', false);
    runner.assert(
      await getSetting(browser, 'restoreOnMouseHover') === false,
      'restoreOnMouseHover set to false',
    );

    // Close any restored page from Phase A so we start fresh
    const pagesAfterA = await browser.pages();
    for (const p of pagesAfterA) {
      if (p.url().startsWith('http://127.0.0.1')) await p.close().catch(() => {});
    }
    await sleep(300);

    // Open the test page again
    const targetPage2 = await browser.newPage();
    await targetPage2.goto(testUrl, { waitUntil: 'load', timeout: 10000 });
    await sleep(1000);

    const tabs2 = await queryChromeTabs(browser);
    const targetTab2 = tabs2.find(t => t.url && t.url.startsWith('http://127.0.0.1'));
    runner.assert(targetTab2 != null, 'target tab opened for Phase B');

    const blankPage2 = await browser.newPage();
    await blankPage2.goto('about:blank');
    await sleep(300);

    log(`  Suspending tab ${targetTab2!.id}...`);
    await suspendTabById(browser, targetTab2!.id);
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  park.html appeared (Phase B)');

    const parkPages2 = await getParkPages(browser, extensionId);
    runner.assert(parkPages2.length >= 1, `park page found for Phase B (got ${parkPages2.length})`);

    const parkPage2 = parkPages2[0];
    const parkUrlBefore = parkPage2.url();

    await parkPage2.waitForSelector('#resoteImg', { visible: true, timeout: 10000 }).catch(() => {});
    // Also wait for the onmouseover handler so we test the real restoreEvent='click' behavior
    await parkPage2.waitForFunction(
      () => !!(document.getElementById('resoteImg') as HTMLImageElement | null)?.onmouseover,
      { timeout: 8000 },
    ).catch(() => {});

    log('  Triggering mouseover on #resoteImg (expect no restore)...');
    await parkPage2.evaluate(() => {
      document.getElementById('resoteImg')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }).catch(() => {});

    // Wait a bit — the tab should NOT leave park.html
    await sleep(3000);

    const parkPages2After = await getParkPages(browser, extensionId);
    runner.softAssert(
      parkPages2After.length >= 1,
      `Tab still on park.html after hover when restoreOnMouseHover=false (park pages: ${parkPages2After.length})`,
    );

    await blankPage2.close().catch(() => {});

  } finally {
    if (originalHoverSetting != null) {
      await setSetting(browser, 'restoreOnMouseHover', originalHoverSetting).catch(() => {});
    }
    await browser.close();
    server.close();
    log('Browser closed, server stopped');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
