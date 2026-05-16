/**
 * Tab Suspender — Favicon Loss Diagnostic Test
 *
 * Investigates user-reported bug: tab favicons are replaced by the default
 * grey Chrome globe icon for certain sites (e.g. GitHub).
 *
 * ROOT CAUSE FOUND:
 *   park.ts generateFaviconUri() uses `canvas.width = img.width` which is 0
 *   for SVG favicons without explicit `width`/`height` attributes in the SVG
 *   root element. A 0×0 canvas produces a tiny (empty) PNG, and Chrome
 *   displays the grey globe icon when a favicon PNG is 0×0 or corrupt.
 *
 *   GitHub's SVG has width="32" height="32" so it works correctly,
 *   but many other sites use SVGs with only a viewBox and no explicit
 *   dimensions — those trigger the bug.
 *
 * FIX: park.ts generateFaviconUri() should default to 32×32 canvas when
 *      img.width / img.height reports 0.
 *
 * Tests:
 *   Phase A — SVG with explicit dimensions (32×32): should always work.
 *   Phase B — SVG WITHOUT dimensions (only viewBox): reproduces the grey-icon
 *             bug before the fix; passes after the fix.
 *   Phase C — Full suspend→discard→restore cycle with GitHub.
 *
 * Run:
 *   cd test/puppeteer && npx tsx favicon-loss.test.ts
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

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-favicon');
const TARGET_URL  = 'https://github.com/sergey-drpa/gpu-code-docker/blob/main/docker-compose.yaml';

// ─── SVG test fixtures ────────────────────────────────────────────────────────

// SVG with explicit width + height — img.width should be 32 → canvas 32×32 → proper PNG
const SVG_WITH_DIMS = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="14" fill="#e74c3c"/>' +
  '</svg>'
).toString('base64');

// SVG WITHOUT width/height — only viewBox; img.width will be 0 → canvas 0×0 → bug
const SVG_WITHOUT_DIMS = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="14" fill="#2ecc71"/>' +
  '</svg>'
).toString('base64');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeEvalInSW<T = unknown>(
  browser: Parameters<typeof evalInSW>[0],
  expr: string,
): Promise<T | null> {
  try {
    return await evalInSW<T>(browser, expr);
  } catch (e) {
    log(`  [safeEval warn] ${(e as Error).message.slice(0, 120)}`);
    return null;
  }
}

async function getChromeFavIcon(
  browser: Parameters<typeof evalInSW>[0],
  tabId: number,
): Promise<string | null> {
  const json = await safeEvalInSW<string>(browser, `(async () => {
    const t = await chrome.tabs.get(${tabId}).catch(() => null);
    return JSON.stringify(t ? { favIconUrl: t.favIconUrl ?? null, status: t.status, discarded: t.discarded } : null);
  })()`);
  if (!json) return null;
  return JSON.parse(json)?.favIconUrl ?? null;
}

function favStr(url: string | undefined | null): string {
  if (!url) return `EMPTY(${JSON.stringify(url)})`;
  if (url.startsWith('data:')) return `data:...[${url.length}chars]`;
  return url.slice(0, 80);
}

/** Open park.html directly with a synthetic icon= param; return the resolved link href. */
async function testParkFaviconRendering(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  extensionId: string,
  iconDataUrl: string,
  label: string,
): Promise<{ linkHref: string | null; canvasSize: { w: number; h: number } | null }> {
  const parkBase = `chrome-extension://${extensionId}/park.html`;
  // Use a fake tabId / sessionId that won't match any real tab — park.html
  // will fail to load park data from the background, but generateFaviconUri()
  // still runs from the URL params.
  const parkUrl =
    parkBase +
    '?tabId=99999999&sessionId=0' +
    '&title=' + encodeURIComponent(label) +
    '&url=' + encodeURIComponent('https://example.com/') +
    '&icon=' + encodeURIComponent(iconDataUrl);

  const testPage = await browser.newPage();
  try {
    await testPage.goto(parkUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    // Give generateFaviconUri + img.onload time to run (max 4 s)
    await sleep(4000);

    const result = await testPage.evaluate(() => {
      const link = document.getElementById('faviconLink') as HTMLLinkElement | null;
      const href = link?.href ?? null;

      // Measure canvas dimensions from the data URI by decoding the PNG header
      // PNG width/height are at bytes 16-23 (big-endian uint32)
      if (href && href.startsWith('data:image/png;base64,')) {
        const b64 = href.slice('data:image/png;base64,'.length);
        try {
          const binary = atob(b64);
          if (binary.length >= 24) {
            const w =
              (binary.charCodeAt(16) << 24 |
               binary.charCodeAt(17) << 16 |
               binary.charCodeAt(18) << 8  |
               binary.charCodeAt(19)) >>> 0;
            const h =
              (binary.charCodeAt(20) << 24 |
               binary.charCodeAt(21) << 16 |
               binary.charCodeAt(22) << 8  |
               binary.charCodeAt(23)) >>> 0;
            return { linkHref: href, canvasSize: { w, h } };
          }
        } catch {}
      }
      return { linkHref: href, canvasSize: null };
    });

    return result as { linkHref: string | null; canvasSize: { w: number; h: number } | null };
  } finally {
    await testPage.close().catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Tab Suspender — Favicon Loss Diagnostic');

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await launchBrowser(SESSION_DIR);
  log('Browser launched');

  try {
    const extensionId = await getExtensionId(browser);
    log(`Extension ID: ${extensionId}`);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE A — SVG WITH explicit dimensions (width="32" height="32")
    // ══════════════════════════════════════════════════════════════════════════
    log('\n══ Phase A: SVG with explicit dimensions ══════════════════════════════');
    const resA = await testParkFaviconRendering(browser, extensionId, SVG_WITH_DIMS, 'SVG-with-dims');
    log(`  link href: ${favStr(resA.linkHref)}`);
    log(`  canvas size from PNG header: ${JSON.stringify(resA.canvasSize)}`);

    runner.assert(
      resA.canvasSize !== null && resA.canvasSize.w > 0 && resA.canvasSize.h > 0,
      `[Phase A] SVG with dimensions → non-empty PNG favicon (got ${JSON.stringify(resA.canvasSize)})`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE B — SVG WITHOUT dimensions (only viewBox) — reproduces the bug
    // ══════════════════════════════════════════════════════════════════════════
    log('\n══ Phase B: SVG WITHOUT explicit dimensions (viewBox only) ════════════');
    const resB = await testParkFaviconRendering(browser, extensionId, SVG_WITHOUT_DIMS, 'SVG-no-dims');
    log(`  link href: ${favStr(resB.linkHref)}`);
    log(`  canvas size from PNG header: ${JSON.stringify(resB.canvasSize)}`);

    const bPassed = resB.canvasSize !== null && resB.canvasSize.w > 0 && resB.canvasSize.h > 0;
    if (!bPassed) {
      log('  *** BUG REPRODUCED: 0×0 canvas → empty PNG → grey Chrome globe icon ***');
    }
    runner.assert(
      bPassed,
      `[Phase B] SVG without dimensions → non-empty PNG favicon (got ${JSON.stringify(resB.canvasSize)})`,
    );

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE C — Full suspend→discard→restore cycle with GitHub
    // ══════════════════════════════════════════════════════════════════════════
    log(`\n══ Phase C: Full suspend→discard→restore cycle (GitHub) ══════════════`);

    const page = await browser.newPage();
    try {
      await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
      log(`  Navigation note: ${(e as Error).message}`);
    }
    await sleep(2000);

    const initialTabJson = await safeEvalInSW<string>(browser, `(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find(t => t.url && t.url.includes('github.com'));
      return JSON.stringify(t ? { id: t.id, favIconUrl: t.favIconUrl ?? null } : null);
    })()`);
    const initialTab = JSON.parse(initialTabJson ?? 'null');

    if (!initialTab) {
      runner.assert(false, '[Phase C] GitHub tab found');
      await browser.close();
      runner.summarize();
      process.exit(1);
    }

    const tabId: number = initialTab.id;
    log(`  Tab ID: ${tabId}, initial fav: ${favStr(initialTab.favIconUrl)}`);
    runner.assert(!!initialTab.favIconUrl, `[Phase C] Initial favIconUrl non-empty`);

    // Move focus away so the GitHub tab is not active
    const bgPage = await browser.newPage();
    await bgPage.goto('about:blank');
    await sleep(500);

    // Force suspend
    await suspendTabById(browser, tabId);
    log('  parkTab() called');
    try {
      await waitForParkPages(browser, extensionId, 1, 10000);
      log('  Park page appeared');
    } catch {
      log('  WARNING: park page did not appear within 10s');
    }
    await sleep(1000);

    // Check park page icon=
    const parkPages = await getParkPages(browser, extensionId);
    let parkIconParam: string | null = null;
    if (parkPages.length > 0) {
      const pUrl = new URL(parkPages[0].url());
      parkIconParam = pUrl.searchParams.get('icon');
      log(`  park URL icon= : ${favStr(parkIconParam)}`);
    }
    runner.softAssert(!!parkIconParam, `[Phase C] park.html has non-empty icon= param`);

    const favAfterSuspend = await getChromeFavIcon(browser, tabId);
    log(`  favIconUrl after suspend: ${favStr(favAfterSuspend)}`);

    // Discard
    await discardTabById(browser, tabId);
    await sleep(2000);
    const favAfterDiscard = await getChromeFavIcon(browser, tabId);
    log(`  favIconUrl after discard: ${favStr(favAfterDiscard)}`);
    runner.softAssert(!!favAfterDiscard, `[Phase C] favIconUrl non-empty after discard`);

    // Restore — navigate the suspended tab back to the original URL
    const parkPagesForRestore = await getParkPages(browser, extensionId);
    let originalUrl: string | null = null;
    if (parkPagesForRestore.length > 0) {
      originalUrl = new URL(parkPagesForRestore[0].url()).searchParams.get('url');
      log(`  Original URL extracted from park URL: ${originalUrl?.slice(0, 80)}`);
    }
    if (originalUrl) {
      await safeEvalInSW(browser, `chrome.tabs.update(${tabId}, { url: ${JSON.stringify(originalUrl)} })`);
      log('  Tab restore navigation triggered');
    } else {
      log('  WARNING: Could not determine original URL; skipping restore');
    }
    await sleep(8000);

    const tabUrlAfterRestore = await safeEvalInSW<string>(browser, `(async () => {
      const t = await chrome.tabs.get(${tabId}).catch(() => null);
      return t ? t.url : null;
    })()`);
    log(`  Tab URL after restore: ${tabUrlAfterRestore?.slice(0, 80)}`);
    runner.softAssert(
      typeof tabUrlAfterRestore === 'string' && tabUrlAfterRestore.startsWith('https://github.com'),
      `[Phase C] Tab navigated back to GitHub after restore (got: ${tabUrlAfterRestore?.slice(0, 60)})`,
    );

    const favAfterRestore = await getChromeFavIcon(browser, tabId);
    log(`  favIconUrl after full restore: ${favStr(favAfterRestore)}`);
    runner.assert(!!favAfterRestore, `[Phase C] favIconUrl non-empty after full restore`);

    log('\n─── Phase C Favicon journey ────────────────────────────────────────────');
    log(`  [1] Initial:       ${favStr(initialTab.favIconUrl)}`);
    log(`  [2] park icon=:    ${favStr(parkIconParam)}`);
    log(`  [3] After suspend: ${favStr(favAfterSuspend)}`);
    log(`  [4] After discard: ${favStr(favAfterDiscard)}`);
    log(`  [5] After restore: ${favStr(favAfterRestore)}`);

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
