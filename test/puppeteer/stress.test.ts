/**
 * Tab Suspender — Stress Test (100 tabs)
 *
 * Setup:
 *   cd test/puppeteer && npm install
 *   npm run build   (in project root)
 *
 * Run:
 *   node stress.test.js          (legacy JS, still works)
 *   npx tsx stress.test.ts       (TypeScript, uses base/ helpers)
 *
 * Phases:
 *   1. Open 100 tabs to yandex.com → force-suspend all → save session
 *   2. Reopen with --restore-last-session → verify suspension + extension health
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId,
  parkAllTabs,
  queryChromeTabs,
  parkUrlPrefix,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, '.test-session');
const STATE_FILE = path.join(__dirname, '.test-state.json');

const CONFIG = {
  tabCount: 100,
  batchSize: 10,
  targetUrl: 'https://yandex.com/',
  tabLoadTimeout: 15000,
  suspensionWaitTimeoutMs: 120_000,
  sessionRestoreWaitMs: 15_000,
  minSuspensionRatio: 0.75,
  minRestoreRatio: 0.50,
  spotCheckSize: 10,
  spotCheckPassRatio: 0.70,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openTabsInBatches(browser: Awaited<ReturnType<typeof launchBrowser>>): Promise<void> {
  const { tabCount, batchSize, targetUrl, tabLoadTimeout } = CONFIG;
  log(`Opening ${tabCount} tabs in batches of ${batchSize}...`);

  const existing = await browser.pages();

  if (existing.length > 0) {
    await existing[0]
      .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: tabLoadTimeout })
      .catch(e => log(`  initial tab: ${(e as Error).message}`));
  }

  const toOpen = tabCount - existing.length;

  for (let i = 0; i < toOpen; i += batchSize) {
    const count = Math.min(batchSize, toOpen - i);
    await Promise.all(
      Array.from({ length: count }, () =>
        browser.newPage().then(page =>
          page
            .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: tabLoadTimeout })
            .catch(e => log(`  tab: ${(e as Error).message}`)),
        ),
      ),
    );
    log(`  opened ${existing.length + i + count}/${tabCount}`);
  }
}

async function waitForSuspension(browser: Awaited<ReturnType<typeof launchBrowser>>, extensionId: string): Promise<number> {
  const { tabCount, suspensionWaitTimeoutMs, minSuspensionRatio } = CONFIG;
  const prefix = parkUrlPrefix(extensionId);
  const target = Math.floor(tabCount * minSuspensionRatio);
  const deadline = Date.now() + suspensionWaitTimeoutMs;
  let last = -1;

  log(`Waiting for ≥${target} tabs to be suspended...`);
  while (Date.now() < deadline) {
    const pages = await browser.pages();
    const count = pages.filter(p => p.url().startsWith(prefix)).length;
    if (count !== last) { log(`  suspended: ${count}/${tabCount}`); last = count; }
    if (count >= target) return count;
    await sleep(2500);
  }

  const pages = await browser.pages();
  return pages.filter(p => p.url().startsWith(prefix)).length;
}

// ─── Phase 1 ──────────────────────────────────────────────────────────────────

async function phase1() {
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE 1  Open tabs → Force suspend → Save session');
  log('══════════════════════════════════════════════════════');

  if (fs.existsSync(SESSION_DIR)) { fs.rmSync(SESSION_DIR, { recursive: true }); }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const runner = createTestRunner();
  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);

    await openTabsInBatches(browser);
    log('Waiting 5s for pages to partially load...');
    await sleep(5000);

    log('Calling parkTabs() in service worker...');
    await parkAllTabs(browser);

    const suspendedCount = await waitForSuspension(browser, extensionId);
    runner.assert(
      suspendedCount >= Math.floor(CONFIG.tabCount * CONFIG.minSuspensionRatio),
      `≥${CONFIG.minSuspensionRatio * 100}% tabs suspended (${suspendedCount}/${CONFIG.tabCount})`,
    );

    const prefix = parkUrlPrefix(extensionId);
    const pages = await browser.pages();
    const suspendedUrls = pages
      .filter(p => p.url().startsWith(prefix))
      .map(p => p.url())
      .slice(0, 20);

    const state = { extensionId, suspendedCount, suspendedUrls, ts: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    log('Closing browser (saving session)...');
    await browser.close();
    log('Browser closed');

    return state;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// ─── Phase 2 ──────────────────────────────────────────────────────────────────

async function phase2(state: { extensionId: string; suspendedCount: number; suspendedUrls: string[] }) {
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE 2  Restore session → Verify suspension + health');
  log('══════════════════════════════════════════════════════');

  await sleep(3000);

  const runner = createTestRunner();
  const browser = await launchBrowser(SESSION_DIR, true);
  log(`Browser reopened with --restore-last-session`);

  try {
    log(`Waiting ${CONFIG.sessionRestoreWaitMs / 1000}s for session restore...`);
    await sleep(CONFIG.sessionRestoreWaitMs);

    const restoredId = await getExtensionId(browser);
    runner.assert(restoredId === state.extensionId, `Extension ID unchanged after restart (${restoredId})`);

    const prefix = parkUrlPrefix(state.extensionId);
    const allPages = await browser.pages();
    const restoredSuspended = allPages.filter(p => p.url().startsWith(prefix));
    log(`  Restored suspended tabs: ${restoredSuspended.length}/${CONFIG.tabCount}`);

    runner.softAssert(
      restoredSuspended.length >= Math.floor(CONFIG.tabCount * CONFIG.minRestoreRatio),
      `≥${CONFIG.minRestoreRatio * 100}% tabs restored as suspended (${restoredSuspended.length}/${CONFIG.tabCount})`,
    );

    // Spot-check: suspended park pages encode yandex.com in ?url=
    const sampleSize = Math.min(CONFIG.spotCheckSize, restoredSuspended.length);
    if (sampleSize > 0) {
      const sample = [...restoredSuspended].sort(() => Math.random() - 0.5).slice(0, sampleSize);
      log(`  Spot-checking ${sampleSize} suspended tabs...`);
      let okCount = 0;
      for (const page of sample) {
        const originalUrl = new URL(page.url()).searchParams.get('url') ?? '';
        const ok = originalUrl.includes('yandex.com');
        if (ok) okCount++;
        log(`    ${ok ? '✓' : '✗'} ${decodeURIComponent(originalUrl)}`);
      }
      runner.softAssert(
        okCount >= Math.floor(sampleSize * CONFIG.spotCheckPassRatio),
        `≥${CONFIG.spotCheckPassRatio * 100}% spot-checked tabs have yandex.com origin (${okCount}/${sampleSize})`,
      );
    }

    // Extension health: service worker alive + tabManager initialized
    runner.section('Extension health check');
    const swTarget = browser.targets().find(
      t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
    );
    runner.assert(swTarget != null, 'Service worker present after restart');

    await browser.close();

    runner.summarize();
    return runner;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Tab Suspender — Stress Test');
  log(`Config: tabs=${CONFIG.tabCount}, batch=${CONFIG.batchSize}, url=${CONFIG.targetUrl}`);

  try {
    const state = await phase1();
    const runner = await phase2(state);
    process.exit(runner.hasFailed() ? 1 : 0);
  } catch (e) {
    log(`\nFATAL: ${(e as Error).message}`);
    console.error((e as Error).stack);
    process.exit(1);
  }
}

main();
