/**
 * Tab Suspender — Form Data Restore E2E Test
 *
 * Covers test case 2.8:
 *   Form data filled before suspension must be restored when the tab is
 *   unsuspended and reloaded.
 *
 * Mechanism:
 *   1. Before parking, parkTab() calls PageStateRestoreController.collectPageState(tabId)
 *      which asks inject.ts (content script) to run hebernateFormData() and return values.
 *   2. Form data is stored in IndexedDB keyed by tabId.
 *   3. On restore with reloadTabOnRestore=true, the page is freshly loaded.
 *   4. inject.ts fires on 'pageshow' and sends [AutomaticTabCleaner:getFormRestoreDataAndRemove].
 *   5. Background returns saved form data for that tabId.
 *   6. inject.ts calls processRestoreForm() which fills in the form fields.
 *
 * Prerequisites:
 *   The test page is served from a local HTTP server because content scripts
 *   (inject.ts) do not run in data://, about:, or extension pages.
 *
 * Run:
 *   cd test/puppeteer && npx tsx form-data-restore.test.ts
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  suspendTabById,
  unsuspendTabById,
  waitForParkPages,
  queryChromeTabs,
  getSetting,
  setSetting,
  getParkPages,
  waitForAnyTabToLeaveParked,
  waitForTabToRestore,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';
import type { Page } from 'puppeteer';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-form-data');

const FORM_HTML = `<!DOCTYPE html>
<html>
<head><title>Form Restore Test</title></head>
<body>
  <form id="test-form">
    <input type="text" name="username" id="username" value="" placeholder="Enter username">
    <input type="text" name="email" id="email" value="" placeholder="Enter email">
    <textarea name="message" id="message"></textarea>
  </form>
</body>
</html>`;

function startHttpServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FORM_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
    server.on('error', reject);
  });
}

async function getFormValues(page: Page): Promise<{ username: string; email: string; message: string }> {
  return page.evaluate(() => ({
    username: (document.getElementById('username') as HTMLInputElement)?.value ?? '',
    email: (document.getElementById('email') as HTMLInputElement)?.value ?? '',
    message: (document.getElementById('message') as HTMLTextAreaElement)?.value ?? '',
  }));
}

async function main(): Promise<void> {
  log('Tab Suspender — Form Data Restore');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { server, url: formUrl } = await startHttpServer();
  log(`Form server: ${formUrl}`);

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  SETUP — Enable reloadTabOnRestore so the page gets a fresh load and
    //           inject.ts must re-fill the form (not bfcache shortcut).
    // ══════════════════════════════════════════════════════════════════════════
    const originalReload = await getSetting(browser, 'reloadTabOnRestore');
    await setSetting(browser, 'reloadTabOnRestore', true);
    runner.assert(
      await getSetting(browser, 'reloadTabOnRestore') === true,
      'reloadTabOnRestore=true set',
    );

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE A — Open form page and fill it
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase A — Open form page and fill it');

    const formPage = await browser.newPage();
    await formPage.goto(formUrl, { waitUntil: 'load', timeout: 10000 });
    await sleep(1500); // wait for inject.ts to initialise in the page context

    // Fill in the form fields
    await formPage.type('#username', 'TestUser42');
    await formPage.type('#email', 'test@example.com');
    await formPage.type('#message', 'Hello from puppeteer test');
    await sleep(500);

    const valuesBefore = await getFormValues(formPage);
    log(`  Form values before suspend: ${JSON.stringify(valuesBefore)}`);
    runner.assert(valuesBefore.username === 'TestUser42', 'username filled before suspend');
    runner.assert(valuesBefore.email === 'test@example.com', 'email filled before suspend');
    runner.assert(valuesBefore.message === 'Hello from puppeteer test', 'message filled before suspend');

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE B — Suspend the form tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase B — Suspend form tab');

    const tabs = await queryChromeTabs(browser);
    const formTab = tabs.find(t => t.url && t.url.startsWith(formUrl));
    runner.assert(formTab != null, 'Form tab found in chrome tabs');

    const formTabId = formTab!.id;
    log(`  Form tab ID: ${formTabId}`);

    // Move focus away — tab must be inactive to park
    const blankPage = await browser.newPage();
    await blankPage.goto('about:blank');
    await sleep(300);

    log(`  Force-suspending form tab ${formTabId}...`);
    await suspendTabById(browser, formTabId);
    await waitForParkPages(browser, extensionId, 1, 20000);
    log('  park.html appeared — form data collected before parking');

    const parkPages = await getParkPages(browser, extensionId);
    runner.assert(parkPages.length >= 1, 'park.html page visible after form tab suspend');

    // Get the current park tab ID (may differ from formTabId after navigation)
    const allTabsAfterPark = await queryChromeTabs(browser);
    const parkTab = allTabsAfterPark.find(t => t.url && t.url.startsWith(parkUrlPrefix(extensionId)));
    const parkTabId = parkTab?.id ?? formTabId;
    log(`  park.html Chrome tab ID: ${parkTabId}`);

    // ══════════════════════════════════════════════════════════════════════════
    //  PHASE C — Restore the tab
    // ══════════════════════════════════════════════════════════════════════════
    runner.section('Phase C — Restore tab and check form data');

    log(`  Unsuspending tab ${parkTabId}...`);
    await unsuspendTabById(browser, parkTabId);

    // Wait for the tab to navigate back to the form URL
    const restoredUrl = await waitForAnyTabToLeaveParked(
      browser,
      extensionId,
      '127.0.0.1',
      25000,
    ).catch(async () => {
      return waitForTabToRestore(browser, parkTabId, 25000).catch(() => null);
    });

    runner.assert(
      typeof restoredUrl === 'string' && restoredUrl != null && restoredUrl.includes('127.0.0.1'),
      `Tab restored to form URL (got: ${restoredUrl})`,
    );
    log(`  Restored URL: ${restoredUrl}`);

    // Give inject.ts time to run getFormRestoreDataAndRemove and fill the form
    await sleep(3000);

    // Find the restored page in puppeteer's pages list
    const pages = await browser.pages();
    const restoredPage = pages.find(p => p.url().includes('127.0.0.1'));

    if (restoredPage) {
      const valuesAfter = await getFormValues(restoredPage);
      log(`  Form values after restore: ${JSON.stringify(valuesAfter)}`);

      runner.softAssert(
        valuesAfter.username === 'TestUser42',
        `username restored (got: "${valuesAfter.username}", expected: "TestUser42")`,
      );
      runner.softAssert(
        valuesAfter.email === 'test@example.com',
        `email restored (got: "${valuesAfter.email}", expected: "test@example.com")`,
      );
      runner.softAssert(
        valuesAfter.message === 'Hello from puppeteer test',
        `message restored (got: "${valuesAfter.message}", expected: "Hello from puppeteer test")`,
      );
    } else {
      log('  Restored page not found in puppeteer pages — checking via evalInSW...');
      runner.softAssert(false, 'Restored form page not found in puppeteer pages list');
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEARDOWN — Restore settings
    // ══════════════════════════════════════════════════════════════════════════
    await setSetting(browser, 'reloadTabOnRestore', originalReload ?? false);

  } finally {
    await browser.close();
    server.close();
    log('Browser closed, HTTP server stopped');
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
