/**
 * Tab Suspender — Corrupt Storage Regression Test
 *
 * Reproduces user-reported bug: after storage corruption (e.g. disk-full),
 * the suspend timeout resets to 0s or 30s instead of falling back to the
 * safe default (1800s = 30 min).
 *
 * Run:
 *   cd test/puppeteer && npx tsx corrupt-storage.test.ts
 *
 * Storage architecture (store.ts):
 *   settings.set(key, val) writes to BOTH:
 *     - chrome.storage.local  keyed as "store.tabSuspenderSettings.<key>"
 *     - chrome.storage.sync   keyed as "<key>" (hot-standby backup)
 *   On startup, if local is missing, initOrMigrateSettings() tries to recover
 *   from sync before falling back to DEFAULT_SETTINGS.
 *
 * Why CDP clear, not file deletion:
 *   chrome.storage.sync may live in the cloud (Google account) and can't be
 *   reliably erased by deleting local files. Calling chrome.storage.sync.clear()
 *   via CDP works in both signed-in and offline profiles and correctly models
 *   the "all storage gone" scenario regardless of cloud sync status.
 *
 * Test plan:
 *   Phase A – local storage cleared only:
 *     Extension should recover timeout=USER_TIMEOUT_S from sync storage.
 *
 *   Phase B – local + sync both cleared:
 *     Extension must fall back to DEFAULT_SETTINGS.timeout = 1800s.
 *     Must NOT reset to 0 or a tiny value (the reported bug).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import { getExtensionId, evalInSW, queryChromeTabs } from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, '.test-session-corrupt');
const TARGET_URL = 'https://yandex.com/';

const USER_TIMEOUT_S     = 60;       // 1 minute — what the "user" sets in the test
const DEFAULT_TIMEOUT_S  = 30 * 60; // 1800s — extension's DEFAULT_SETTINGS.timeout
const MIN_SAFE_TIMEOUT_S = 60;      // anything below this = dangerous suspension bug

// ─── Settings helpers (via CDP in service worker) ────────────────────────────

type BrowserArg = Parameters<typeof evalInSW>[0];

async function getTimeoutSetting(browser: BrowserArg): Promise<unknown> {
  return evalInSW(browser, 'settings.get("timeout")');
}

async function setTimeoutSetting(browser: BrowserArg, seconds: number): Promise<void> {
  await evalInSW(browser, `settings.set("timeout", ${seconds})`);
  await sleep(500); // let storage write flush
}

async function getAllRelevantSettings(browser: BrowserArg): Promise<Record<string, unknown>> {
  const json = await evalInSW<string>(browser, `(async () => {
    const keys = ["timeout", "active", "adaptiveSuspendTimeout"];
    const result = {};
    for (const k of keys) result[k] = await settings.get(k);
    return JSON.stringify(result);
  })()`);
  return JSON.parse(json) as Record<string, unknown>;
}

// Clear storage via CDP — works for both local profiles and cloud-synced profiles.
async function clearLocalStorage(browser: BrowserArg): Promise<void> {
  await evalInSW(browser, 'chrome.storage.local.clear()');
  await sleep(300);
}

async function clearSyncStorage(browser: BrowserArg): Promise<void> {
  await evalInSW(browser, 'chrome.storage.sync.clear()');
  await sleep(300);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function openTabs(browser: Awaited<ReturnType<typeof launchBrowser>>): Promise<void> {
  const [p1, p2] = await Promise.all([browser.newPage(), browser.newPage()]);
  await Promise.all([
    p1.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => log(`  tab1: ${(e as Error).message}`)),
    p2.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => log(`  tab2: ${(e as Error).message}`)),
  ]);
  await sleep(1000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('Tab Suspender — Corrupt Storage Regression Test');
  log(`Session dir: ${SESSION_DIR}`);

  const runner = createTestRunner();

  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true });
    log('Cleared previous session directory');
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SETUP — Set user timeout = 60s, save session
  // ═══════════════════════════════════════════════════════════════════════════
  log('\n══════════════════════════════════════════════════════');
  log('  SETUP  Open browser → Set timeout → Save session');
  log('══════════════════════════════════════════════════════');

  const browser0 = await launchBrowser(SESSION_DIR);
  log('Browser launched');
  let extensionId: string;

  try {
    extensionId = await getExtensionId(browser0);
    log(`Extension ID: ${extensionId}`);
    await openTabs(browser0);

    const chromeTabs = await queryChromeTabs(browser0);
    runner.assert(
      chromeTabs.filter(t => t.url?.includes('yandex')).length >= 2,
      'Setup: ≥2 yandex.com tabs open',
    );

    log(`  Setting timeout to ${USER_TIMEOUT_S}s...`);
    await setTimeoutSetting(browser0, USER_TIMEOUT_S);

    const storedTimeout = await getTimeoutSetting(browser0);
    runner.assert(
      storedTimeout === USER_TIMEOUT_S,
      `Setup: timeout stored as ${USER_TIMEOUT_S}s (got ${storedTimeout})`,
    );
    log(`  Settings before close: ${JSON.stringify(await getAllRelevantSettings(browser0))}`);

    log('\nClosing browser (saving session)...');
    await browser0.close();
    log('Browser closed');
  } catch (e) {
    await browser0.close().catch(() => {});
    throw e;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE A — Clear local storage only → sync recovery should preserve value
  // ═══════════════════════════════════════════════════════════════════════════
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE A  Clear local only → sync recovery (expect timeout=60)');
  log('══════════════════════════════════════════════════════');

  // Open browser just to clear local storage via CDP, then close immediately.
  // This is more reliable than file deletion: works with and without Google sync.
  const browserA0 = await launchBrowser(SESSION_DIR, true);
  try {
    await getExtensionId(browserA0); // wait for SW
    await sleep(3000);               // let extension fully initialize first
    log('  Clearing chrome.storage.local via CDP...');
    await clearLocalStorage(browserA0);
    log('  Local storage cleared');
    const verifyLocal = await getTimeoutSetting(browserA0);
    log(`  timeout after local clear: ${verifyLocal} (expected undefined)`);
    await browserA0.close();
    await sleep(1000);
  } catch (e) {
    await browserA0.close().catch(() => {});
    throw e;
  }

  // Now restart — extension should recover timeout from sync
  const browserA = await launchBrowser(SESSION_DIR, true);
  log('Browser restarted for Phase A check');
  try {
    await sleep(10000); // let extension initialize and run initOrMigrateSettings
    await getExtensionId(browserA);

    const settingsA = await getAllRelevantSettings(browserA);
    log(`  Settings after local-only corruption: ${JSON.stringify(settingsA)}`);

    const timeoutA = settingsA['timeout'] as number;

    runner.softAssert(
      timeoutA === USER_TIMEOUT_S,
      `Phase-A: timeout recovered from sync (${timeoutA}s === ${USER_TIMEOUT_S}s)`,
    );
    runner.assert(
      typeof timeoutA === 'number' && timeoutA >= MIN_SAFE_TIMEOUT_S,
      `Phase-A: timeout is safe after local corruption (${timeoutA}s ≥ ${MIN_SAFE_TIMEOUT_S}s)`,
    );

    log('\nClosing Phase-A browser...');
    await browserA.close();
    await sleep(1000);
  } catch (e) {
    await browserA.close().catch(() => {});
    throw e;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE B — Clear local + sync → must fall back to DEFAULT_SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE B  Clear local + sync → default fallback (expect timeout=1800)');
  log('══════════════════════════════════════════════════════');

  const browserB0 = await launchBrowser(SESSION_DIR, true);
  try {
    await getExtensionId(browserB0);
    await sleep(3000);
    log('  Clearing chrome.storage.local via CDP...');
    await clearLocalStorage(browserB0);
    log('  Clearing chrome.storage.sync via CDP...');
    await clearSyncStorage(browserB0);
    log('  Both storages cleared');
    const verifyTimeout = await getTimeoutSetting(browserB0);
    log(`  timeout after full clear: ${verifyTimeout} (expected undefined)`);
    await browserB0.close();
    await sleep(1000);
  } catch (e) {
    await browserB0.close().catch(() => {});
    throw e;
  }

  const browserB = await launchBrowser(SESSION_DIR, true);
  log('Browser restarted for Phase B check');
  try {
    await sleep(10000);

    const restoredId = await getExtensionId(browserB);
    runner.assert(restoredId === extensionId, `Phase-B: Extension ID unchanged (${restoredId})`);

    const settingsB = await getAllRelevantSettings(browserB);
    log(`  Settings after full corruption: ${JSON.stringify(settingsB)}`);

    const timeoutB = settingsB['timeout'] as number;
    const activeB  = settingsB['active'];

    // Core regression: must not be 0 or dangerously small
    runner.assert(
      typeof timeoutB === 'number' && timeoutB >= MIN_SAFE_TIMEOUT_S,
      `Phase-B: timeout after full corruption is safe — got ${timeoutB}s, need ≥${MIN_SAFE_TIMEOUT_S}s`,
    );

    // Should fall back to DEFAULT_SETTINGS.timeout = 1800
    runner.softAssert(
      timeoutB === DEFAULT_TIMEOUT_S,
      `Phase-B: timeout falls back to DEFAULT_SETTINGS (${DEFAULT_TIMEOUT_S}s) — got ${timeoutB}s`,
    );

    // active flag must be a proper boolean
    runner.assert(
      typeof activeB === 'boolean',
      `Phase-B: 'active' is boolean after full corruption (got: ${JSON.stringify(activeB)})`,
    );

    log(`\n  Verdict: timeout=${timeoutB}s — ${
      timeoutB === DEFAULT_TIMEOUT_S ? '✓ correct default applied' :
      timeoutB >= MIN_SAFE_TIMEOUT_S  ? '! safe but unexpected value' :
      '✗ DANGEROUS — suspension bug!'
    }`);

    await browserB.close();
  } catch (e) {
    await browserB.close().catch(() => {});
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
