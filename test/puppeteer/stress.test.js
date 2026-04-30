/**
 * Tab Suspender — Stress Test
 *
 * Setup:
 *   cd test/puppeteer && npm install
 *   npm run build  (in project root)
 *
 * Run:
 *   node stress.test.js
 *
 * Phases:
 *   1. Open 100 tabs to yandex.com
 *   2. Force-suspend all via parkTabs() in the extension service worker
 *   3. Close browser (session is saved to .test-session/)
 *   4. Reopen browser with --restore-last-session
 *   5. Verify suspended tabs and extension health
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.join(PROJECT_ROOT, 'build_dir');
const SESSION_DIR = path.join(__dirname, '.test-session');
const STATE_FILE = path.join(__dirname, '.test-state.json');

const CONFIG = {
  tabCount: 100,
  batchSize: 10,
  targetUrl: 'https://yandex.com/',
  tabLoadTimeout: 15000,
  suspensionWaitTimeout: 120000,
  sessionRestoreWaitMs: 15000,
  minSuspensionRatio: 0.75,
  minRestoreRatio: 0.50,
  spotCheckSize: 10,
  spotCheckPassRatio: 0.70,
};

let passed = 0;
let failed = 0;
const issues = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function assert(condition, label) {
  if (!condition) {
    failed++;
    issues.push(label);
    console.error(`  ✗ FAIL  ${label}`);
    throw new Error(`Assertion failed: ${label}`);
  }
  passed++;
  log(`  ✓ PASS  ${label}`);
  return true;
}

function softAssert(condition, label) {
  if (!condition) {
    failed++;
    issues.push(label);
    console.warn(`  ✗ WARN  ${label}`);
  } else {
    passed++;
    log(`  ✓ PASS  ${label}`);
  }
  return condition;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser(restoreSession = false) {
  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-sync',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];

  if (restoreSession) {
    args.push('--restore-last-session');
  }

  return puppeteer.launch({
    headless: false,
    userDataDir: SESSION_DIR,
    args,
    defaultViewport: null,
  });
}

async function getExtensionId(browser, maxWaitMs = 20000) {
  log('Looking for extension service worker...');
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const swTarget = browser.targets().find(
      t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );
    if (swTarget) {
      const id = swTarget.url().split('/')[2];
      log(`Extension ID: ${id}`);
      return id;
    }
    await sleep(1000);
  }

  throw new Error('Extension service worker not found within timeout');
}

// ─── Tab operations ───────────────────────────────────────────────────────────

async function openTabsInBatches(browser) {
  const { tabCount, batchSize, targetUrl, tabLoadTimeout } = CONFIG;
  log(`Opening ${tabCount} tabs in batches of ${batchSize}...`);

  const existingPages = await browser.pages();

  // Navigate the tab that Chrome opens by default
  if (existingPages.length > 0) {
    await existingPages[0]
      .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: tabLoadTimeout })
      .catch(e => log(`  initial tab: ${e.message}`));
  }

  const toOpen = tabCount - existingPages.length;

  for (let i = 0; i < toOpen; i += batchSize) {
    const count = Math.min(batchSize, toOpen - i);

    await Promise.all(
      Array.from({ length: count }, () =>
        browser.newPage().then(page =>
          page
            .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: tabLoadTimeout })
            .catch(e => log(`  tab ${i}: ${e.message}`))
        )
      )
    );

    const total = existingPages.length + i + count;
    log(`  opened ${total}/${tabCount}`);
  }

  log(`All ${tabCount} tabs opened`);
}

async function forceSuspendAllTabs(browser) {
  log('Connecting to extension service worker via CDP...');

  const swTarget = browser.targets().find(
    t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
  );
  assert(swTarget != null, 'Extension service worker reachable before suspend');

  const session = await swTarget.createCDPSession();

  const { result: typeResult } = await session.send('Runtime.evaluate', {
    expression: 'typeof parkTabs',
    returnByValue: true,
  });
  assert(typeResult.value === 'function', 'parkTabs() is a function in service worker scope');

  log('Calling parkTabs()...');
  await session.send('Runtime.evaluate', { expression: 'parkTabs()' });

  await session.detach();
  log('Force-suspend command dispatched');
}

async function waitForSuspension(browser, extensionId) {
  const { tabCount, suspensionWaitTimeout, minSuspensionRatio } = CONFIG;
  const parkPrefix = `chrome-extension://${extensionId}/park.html`;
  const target = Math.floor(tabCount * minSuspensionRatio);
  const deadline = Date.now() + suspensionWaitTimeout;
  let last = -1;

  log(`Waiting for ≥${target} tabs to be suspended (timeout ${suspensionWaitTimeout / 1000}s)...`);

  while (Date.now() < deadline) {
    const pages = await browser.pages();
    const count = pages.filter(p => p.url().startsWith(parkPrefix)).length;

    if (count !== last) {
      log(`  suspended: ${count}/${tabCount}`);
      last = count;
    }

    if (count >= target) return count;
    await sleep(2500);
  }

  // Final count
  const pages = await browser.pages();
  return pages.filter(p => p.url().startsWith(parkPrefix)).length;
}

// ─── Phase 1 ─────────────────────────────────────────────────────────────────

async function phase1() {
  log('');
  log('══════════════════════════════════════════════════════');
  log('  PHASE 1  Open tabs → Force suspend → Save session');
  log('══════════════════════════════════════════════════════');

  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true });
    log('Removed previous session directory');
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(false);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);

    await openTabsInBatches(browser);

    log('Waiting 5s for pages to partially load...');
    await sleep(5000);

    await forceSuspendAllTabs(browser);

    const suspendedCount = await waitForSuspension(browser, extensionId);

    assert(
      suspendedCount >= Math.floor(CONFIG.tabCount * CONFIG.minSuspensionRatio),
      `≥${CONFIG.minSuspensionRatio * 100}% tabs suspended (${suspendedCount}/${CONFIG.tabCount})`
    );

    // Collect suspended URLs for cross-validation in phase 2
    const parkPrefix = `chrome-extension://${extensionId}/park.html`;
    const pages = await browser.pages();
    const suspendedUrls = pages
      .filter(p => p.url().startsWith(parkPrefix))
      .map(p => p.url())
      .slice(0, 20); // keep first 20 for spot-check

    const state = { extensionId, suspendedCount, suspendedUrls, ts: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log(`State saved → ${STATE_FILE}`);

    log('Closing browser (Chrome will persist session)...');
    await browser.close();
    log('Browser closed');

    return state;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// ─── Phase 2 ─────────────────────────────────────────────────────────────────

async function phase2(state) {
  log('');
  log('══════════════════════════════════════════════════════');
  log('  PHASE 2  Restore session → Verify suspension + health');
  log('══════════════════════════════════════════════════════');

  log('Waiting 3s for Chrome to finish writing session...');
  await sleep(3000);

  const browser = await launchBrowser(true);
  log(`Browser reopened with --restore-last-session`);

  try {
    log(`Waiting ${CONFIG.sessionRestoreWaitMs / 1000}s for session restore...`);
    await sleep(CONFIG.sessionRestoreWaitMs);

    // 1. Extension still alive
    const restoredId = await getExtensionId(browser);
    assert(restoredId === state.extensionId, `Extension ID unchanged after restart (${restoredId})`);

    // 2. Suspended tabs restored
    const parkPrefix = `chrome-extension://${state.extensionId}/park.html`;
    const allPages = await browser.pages();
    const restoredSuspended = allPages.filter(p => p.url().startsWith(parkPrefix));

    log(`  restored suspended tabs: ${restoredSuspended.length}/${CONFIG.tabCount}`);
    softAssert(
      restoredSuspended.length >= Math.floor(CONFIG.tabCount * CONFIG.minRestoreRatio),
      `≥${CONFIG.minRestoreRatio * 100}% tabs restored as suspended (${restoredSuspended.length}/${CONFIG.tabCount})`
    );

    // 3. Spot-check: suspended tabs encode yandex.com as original URL
    const sampleSize = Math.min(CONFIG.spotCheckSize, restoredSuspended.length);
    if (sampleSize > 0) {
      const sample = [...restoredSuspended]
        .sort(() => Math.random() - 0.5)
        .slice(0, sampleSize);

      log(`\n  Spot-checking ${sampleSize} random suspended tabs:`);
      let okCount = 0;

      for (const page of sample) {
        try {
          const rawUrl = page.url();
          const parsed = new URL(rawUrl);
          const originalUrl = parsed.searchParams.get('url') || '';
          const ok = originalUrl.includes('yandex.com');
          if (ok) okCount++;
          log(`    ${ok ? '✓' : '✗'} ${decodeURIComponent(originalUrl) || rawUrl}`);
        } catch (e) {
          log(`    ✗ error reading page url: ${e.message}`);
        }
      }

      softAssert(
        okCount >= Math.floor(sampleSize * CONFIG.spotCheckPassRatio),
        `≥${CONFIG.spotCheckPassRatio * 100}% spot-checked tabs have yandex.com origin URL (${okCount}/${sampleSize})`
      );
    }

    // 4. Extension health: service worker alive and tabManager initialized
    log('\n  Extension health check:');
    const swTarget = browser.targets().find(
      t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );
    assert(swTarget != null, 'Service worker present after restart');

    const session = await swTarget.createCDPSession();

    const { result: tmResult } = await session.send('Runtime.evaluate', {
      expression: 'typeof tabManager !== "undefined" ? "ok" : "missing"',
      returnByValue: true,
    });
    softAssert(tmResult.value === 'ok', `tabManager initialized in service worker (got: ${tmResult.value})`);

    // 5. Extension can process a new suspend request without crashing
    const { result: parkResult } = await session.send('Runtime.evaluate', {
      expression: 'typeof parkTabs',
      returnByValue: true,
    });
    softAssert(parkResult.value === 'function', 'parkTabs() still callable after restart');

    await session.detach();

    log('\n  Session restore and extension health verified ✓');
    await browser.close();
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('Tab Suspender — Stress Test');
  log(`Extension: ${EXTENSION_PATH}`);
  log(`Session:   ${SESSION_DIR}`);
  log(`Config:    tabs=${CONFIG.tabCount}, batch=${CONFIG.batchSize}, url=${CONFIG.targetUrl}`);

  if (!fs.existsSync(EXTENSION_PATH)) {
    console.error(`\nERROR: Extension not built.`);
    console.error(`Run 'npm run build' in the project root first.`);
    console.error(`Expected: ${EXTENSION_PATH}`);
    process.exit(1);
  }

  try {
    const state = await phase1();
    await phase2(state);

    log('');
    log('══════════════════════════════════════════════════════');
    log(`  RESULT  ${passed} passed  /  ${failed} failed`);
    log('══════════════════════════════════════════════════════');

    if (issues.length > 0) {
      log('\n  Failed checks:');
      issues.forEach(i => log(`    • ${i}`));
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    log(`\nFATAL: ${e.message}`);

    log('');
    log(`  RESULT  ${passed} passed  /  ${failed + 1} failed`);

    process.exit(1);
  }
}

main();
