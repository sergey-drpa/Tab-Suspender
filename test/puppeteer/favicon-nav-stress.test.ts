/**
 * Tab Suspender — Favicon Navigation Stress Test
 *
 * Simulates real browsing on GitHub (clicking links, navigating back/forward,
 * opening multiple pages) and repeatedly suspends/restores tabs to reproduce
 * the user-reported "grey Chrome globe" favicon loss bug.
 *
 * Tested scenarios:
 *   Round 1  — suspend immediately after first page load
 *   Round 2  — suspend after clicking into a sub-page (file view)
 *   Round 3  — suspend after back-navigation (browser history in tab)
 *   Round 4  — suspend after rapid sequential navigations (3 pages quickly)
 *   Round 5  — second tab open simultaneously; suspend first tab
 *   Round 6  — suspend → discard → restore (full native-discard cycle)
 *
 * After each round, the favicon journey is logged and asserted:
 *   initial fav → park icon= param → chrome.tabs fav after suspend
 *   → chrome.tabs fav after discard → chrome.tabs fav after restore
 *
 * Run:
 *   cd test/puppeteer && npx tsx favicon-nav-stress.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import {
  getExtensionId, evalInSW,
  suspendTabById, discardTabById,
  waitForParkPages, getParkPages,
} from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';
import type { Browser } from 'puppeteer';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-favicon-stress');

const REPO_ROOT   = 'https://github.com/sergey-drpa/gpu-code-docker';
const REPO_PAGES  = [
  'https://github.com/sergey-drpa/gpu-code-docker',
  'https://github.com/sergey-drpa/gpu-code-docker/blob/main/docker-compose.yaml',
  'https://github.com/sergey-drpa/gpu-code-docker/blob/main/README.md',
  'https://github.com/sergey-drpa/gpu-code-docker/blob/main/Dockerfile',
  'https://github.com/sergey-drpa/gpu-code-docker/commits/main',
  'https://github.com/sergey-drpa',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type BrowserLike = Parameters<typeof evalInSW>[0];

async function safeEval<T = unknown>(browser: BrowserLike, expr: string): Promise<T | null> {
  try {
    return await evalInSW<T>(browser, expr);
  } catch (e) {
    log(`  [safeEval warn] ${(e as Error).message.slice(0, 100)}`);
    return null;
  }
}

function favStr(url: string | undefined | null): string {
  if (!url) return `EMPTY(${JSON.stringify(url)})`;
  if (url.startsWith('data:')) return `data:...[${url.length}ch,${url.slice(5, 14)}]`;
  return url.slice(0, 72);
}

/** Return true if the favicon looks like a proper icon (non-empty, non-tiny). */
function isFavLost(fav: string | null): boolean {
  if (!fav || fav.length < 50) return true;    // empty or placeholder
  return false;
}

async function getTabFavIcon(browser: BrowserLike, tabId: number): Promise<string | null> {
  const json = await safeEval<string>(browser, `(async () => {
    const t = await chrome.tabs.get(${tabId}).catch(() => null);
    return JSON.stringify(t ? { fav: t.favIconUrl ?? null, url: t.url, discarded: t.discarded } : null);
  })()`);
  if (!json) return null;
  return (JSON.parse(json) as { fav: string | null }).fav;
}

async function getTabUrl(browser: BrowserLike, tabId: number): Promise<string | null> {
  const json = await safeEval<string>(browser, `(async () => {
    const t = await chrome.tabs.get(${tabId}).catch(() => null);
    return t ? t.url : null;
  })()`);
  return json;
}

/** Find the Chrome tab ID for the Puppeteer page object. */
async function tabIdForPage(browser: BrowserLike, pageUrl: string): Promise<number | null> {
  const json = await safeEval<string>(browser, `(async () => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(t => t.url && t.url.includes(${JSON.stringify(pageUrl.slice(8, 30))}));
    return JSON.stringify(t ? { id: t.id } : null);
  })()`);
  if (!json) return null;
  return (JSON.parse(json) as { id: number } | null)?.id ?? null;
}

interface RoundResult {
  round: number;
  label: string;
  pageUrlBeforeSuspend: string | null;
  favBeforeSuspend: string | null;
  parkIconParam: string | null;
  favAfterSuspend: string | null;
  favAfterDiscard: string | null;
  favAfterRestore: string | null;
  tabUrlAfterRestore: string | null;
  lost: boolean;
}

/** Suspend tab, record favicon journey, restore it. Returns a RoundResult. */
async function suspendAndRestore(
  browser: Browser,
  browserLike: BrowserLike,
  extensionId: string,
  tabId: number,
  round: number,
  label: string,
  doDiscard: boolean,
): Promise<RoundResult> {
  const pageUrlBeforeSuspend = await getTabUrl(browserLike, tabId);
  const favBeforeSuspend     = await getTabFavIcon(browserLike, tabId);
  log(`  [fav before suspend] ${favStr(favBeforeSuspend)} @ ${pageUrlBeforeSuspend?.slice(19, 72)}`);

  await suspendTabById(browser, tabId);
  log('  parkTab() called');

  try {
    await waitForParkPages(browser, extensionId, 1, 15000);
    log('  Park page appeared');
  } catch {
    log('  WARNING: park page did not appear within 15s');
  }
  await sleep(1500);

  const parkPgs = await getParkPages(browser, extensionId);
  let parkIconParam: string | null = null;
  let originalUrl: string | null   = null;
  if (parkPgs.length > 0) {
    const pu = new URL(parkPgs[0].url());
    parkIconParam = pu.searchParams.get('icon');
    originalUrl   = pu.searchParams.get('url');
  }
  log(`  park icon= ${favStr(parkIconParam)}`);

  const favAfterSuspend = await getTabFavIcon(browserLike, tabId);
  log(`  [fav after suspend]  ${favStr(favAfterSuspend)}`);

  // ── Optional discard ──────────────────────────────────────────────────────
  let favAfterDiscard: string | null = null;
  if (doDiscard) {
    await discardTabById(browser, tabId);
    await sleep(2000);
    favAfterDiscard = await getTabFavIcon(browserLike, tabId);
    log(`  [fav after discard]  ${favStr(favAfterDiscard)}`);
  }

  // ── Restore ───────────────────────────────────────────────────────────────
  if (originalUrl) {
    await safeEval(browserLike, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(originalUrl)} })`);
    log(`  restore triggered → ${originalUrl.slice(0, 72)}`);
  }
  await sleep(8000);

  const tabUrlAfterRestore = await getTabUrl(browserLike, tabId);
  const favAfterRestore    = await getTabFavIcon(browserLike, tabId);
  log(`  [fav after restore]  ${favStr(favAfterRestore)} @ ${tabUrlAfterRestore?.slice(19, 60)}`);

  const lost = isFavLost(favAfterRestore);

  return {
    round, label,
    pageUrlBeforeSuspend, favBeforeSuspend,
    parkIconParam, favAfterSuspend, favAfterDiscard,
    favAfterRestore, tabUrlAfterRestore,
    lost,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Tab Suspender — Favicon Navigation Stress Test');

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  const results: RoundResult[] = [];

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ── Open main GitHub page ─────────────────────────────────────────────
    log(`\nOpening GitHub repo root: ${REPO_ROOT}`);
    const page = await browser.newPage();
    await page.goto(REPO_ROOT, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => log(`  nav note: ${(e as Error).message}`));
    await sleep(2000);

    // Need a background tab so our target is never "active" when we check
    const bgPage = await browser.newPage();
    await bgPage.goto('about:blank');
    await sleep(300);

    const tabId = await tabIdForPage(browser, REPO_ROOT);
    if (!tabId) {
      runner.assert(false, 'GitHub tab found');
      await browser.close();
      runner.summarize();
      process.exit(1);
    }
    log(`GitHub tab ID: ${tabId}`);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 1 — suspend immediately after first page load (repo root)
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 1: suspend right after repo root load ━━━━━━━━━━━━━━━━━━━━━━━');
    await bgPage.bringToFront();
    const r1 = await suspendAndRestore(browser, browser, extensionId, tabId, 1, 'repo-root-immediate', false);
    results.push(r1);
    runner.softAssert(!r1.lost, `[R1] favicon intact after suspend+restore on repo root (park icon ${r1.parkIconParam ? 'present' : 'MISSING'})`);

    // ── Wait for restore to complete ──────────────────────────────────────
    await sleep(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 2 — navigate into a sub-page then suspend
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 2: navigate to docker-compose.yaml then suspend ━━━━━━━━━━━━━');
    const subUrl = 'https://github.com/sergey-drpa/gpu-code-docker/blob/main/docker-compose.yaml';
    await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(subUrl)} })`);
    await sleep(5000); // Let page and favicon fully load
    await bgPage.bringToFront();

    const r2 = await suspendAndRestore(browser, browser, extensionId, tabId, 2, 'sub-page-file-view', false);
    results.push(r2);
    runner.softAssert(!r2.lost, `[R2] favicon intact after suspend+restore on file-view page`);
    await sleep(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 3 — multi-page navigation (3 hops) then suspend
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 3: 3-hop navigation then suspend ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const url of [
      'https://github.com/sergey-drpa/gpu-code-docker/blob/main/README.md',
      'https://github.com/sergey-drpa/gpu-code-docker/commits/main',
      'https://github.com/sergey-drpa/gpu-code-docker',
    ]) {
      await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
      await sleep(3000);
      log(`  Navigated: ${url.slice(19)}`);
      const fav = await getTabFavIcon(browser, tabId);
      log(`    fav: ${favStr(fav)}`);
    }
    await bgPage.bringToFront();

    const r3 = await suspendAndRestore(browser, browser, extensionId, tabId, 3, 'after-3-hop-nav', false);
    results.push(r3);
    runner.softAssert(!r3.lost, `[R3] favicon intact after 3-hop navigation + suspend+restore`);
    await sleep(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 4 — rapid fire navigation (no wait), then suspend
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 4: rapid-fire navigation (no settle time) then suspend ━━━━━━');
    for (const url of REPO_PAGES.slice(0, 4)) {
      await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
      await sleep(600); // Very short: simulate rapid tab-switching
    }
    // Land on repo root
    await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(REPO_ROOT)} })`);
    await sleep(1500); // minimal settle
    await bgPage.bringToFront();

    const r4 = await suspendAndRestore(browser, browser, extensionId, tabId, 4, 'rapid-fire-nav', false);
    results.push(r4);
    runner.softAssert(!r4.lost, `[R4] favicon intact after rapid-fire navigation + suspend+restore`);
    await sleep(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 5 — second GitHub tab open simultaneously; suspend first tab
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 5: two GitHub tabs open; suspend first ━━━━━━━━━━━━━━━━━━━━━━');
    // Open a second GitHub tab
    const page2 = await browser.newPage();
    await page2.goto(
      'https://github.com/sergey-drpa/gpu-code-docker/blob/main/docker-compose.yaml',
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    ).catch(e => log(`  page2 nav: ${(e as Error).message}`));
    await sleep(2000);

    // Navigate first tab a bit
    await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(subUrl)} })`);
    await sleep(4000);
    await bgPage.bringToFront();

    const r5 = await suspendAndRestore(browser, browser, extensionId, tabId, 5, 'with-sibling-tab', false);
    results.push(r5);
    runner.softAssert(!r5.lost, `[R5] favicon intact with sibling tab open`);

    await page2.close().catch(() => {});
    await sleep(2000);

    // ══════════════════════════════════════════════════════════════════════════
    // Round 6 — full suspend → native discard → restore
    // ══════════════════════════════════════════════════════════════════════════
    log('\n━━ Round 6: full suspend → native discard → restore ━━━━━━━━━━━━━━━━━━');
    await safeEval(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(REPO_ROOT)} })`);
    await sleep(5000);
    await bgPage.bringToFront();

    const r6 = await suspendAndRestore(browser, browser, extensionId, tabId, 6, 'with-native-discard', true /* doDiscard */);
    results.push(r6);
    runner.softAssert(
      r6.favAfterDiscard !== null && !isFavLost(r6.favAfterDiscard),
      `[R6] favicon intact after native discard (got: ${favStr(r6.favAfterDiscard)})`,
    );
    runner.softAssert(!r6.lost, `[R6] favicon intact after full discard+restore cycle`);

    // ══════════════════════════════════════════════════════════════════════════
    // Summary table
    // ══════════════════════════════════════════════════════════════════════════
    log('\n════ FAVICON JOURNEY SUMMARY ════════════════════════════════════════════');
    log(`  ${'Round'.padEnd(6)} ${'Label'.padEnd(26)} ${'Before'.padEnd(22)} ${'park icon='.padEnd(22)} ${'After restore'.padEnd(22)} Lost?`);
    log(`  ${'─'.repeat(110)}`);
    for (const r of results) {
      const lostMark = r.lost ? '*** LOST ***' : 'ok';
      log(`  ${String(r.round).padEnd(6)} ${r.label.padEnd(26)} ${favStr(r.favBeforeSuspend).padEnd(22)} ${favStr(r.parkIconParam).padEnd(22)} ${favStr(r.favAfterRestore).padEnd(22)} ${lostMark}`);
    }
    log('═'.repeat(80));

    const lostRounds = results.filter(r => r.lost);
    if (lostRounds.length === 0) {
      log('\nAll rounds: favicon preserved — grey-icon bug NOT reproduced in this run');
    } else {
      log(`\n*** BUG REPRODUCED in ${lostRounds.length} round(s): ${lostRounds.map(r => `R${r.round}(${r.label})`).join(', ')} ***`);
    }

    runner.assert(
      lostRounds.length === 0,
      `All ${results.length} rounds: no favicon loss detected (${lostRounds.length} failures)`,
    );

    await browser.close();
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }

  runner.summarize();
  process.exit(runner.hasFailed() ? 1 : 0);
}

main().catch(e => {
  console.error(`\nFATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});
