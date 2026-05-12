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
 *
 *   Phase C – V2 migration re-run after local corruption (root-cause bug):
 *     Root cause: initOrMigrateSettings() stores "localStorageMigrated" flag
 *     ONLY in chrome.storage.local (skipSync=true). When local is corrupted,
 *     the flag is lost, and the V2 migration from offscreen localStorage runs
 *     AGAIN. If the old V2 localStorage has timeout="30" the migration writes
 *     timeout=30 to local with skipSync=true, then the DEFAULT_SETTINGS loop
 *     sees a valid number (30) and skips the sync fallback — so the user's
 *     correct value in sync is never restored.
 *
 *     This test plants timeout="30" in the offscreen document's localStorage
 *     (simulating old V2 data), clears chrome.storage.local, and restarts.
 *     Before the fix: timeout=30 (FAIL — dangerous).
 *     After the fix:  timeout >= MIN_SAFE_TIMEOUT_S (PASS).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchBrowser, sleep, log } from './base/BrowserHelper.js';
import { getExtensionId, evalInSW, queryChromeTabs } from './base/ExtensionHelper.js';
import { createTestRunner } from './base/AssertHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'test-session', '.test-session-corrupt');
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

// ─── Offscreen document helper ────────────────────────────────────────────────

// Wait until the offscreen document target appears (the extension creates it
// asynchronously during initialization).
async function waitForOffscreenDoc(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  maxWaitMs = 15000,
): Promise<Awaited<ReturnType<typeof browser.targets>>[number]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const target = browser.targets().find(t => t.url().includes('offscreenDocument.html'));
    if (target) return target;
    await sleep(1000);
  }
  throw new Error('Offscreen document target not found within timeout');
}

// Write key=value pairs into the offscreen document's localStorage.
// This simulates old V2 extension data that the migration reads on startup.
async function setOffscreenLocalStorage(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  items: Record<string, string>,
): Promise<void> {
  const target = await waitForOffscreenDoc(browser);
  const session = await target.createCDPSession();
  try {
    const entries = Object.entries(items)
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join('; ');
    const { exceptionDetails } = await session.send('Runtime.evaluate', {
      expression: entries,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`Offscreen CDP error: ${exceptionDetails.text ?? exceptionDetails.exception?.description}`);
    }
  } finally {
    await session.detach();
  }
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE C — V2 migration re-runs after local corruption (root-cause bug)
  // ═══════════════════════════════════════════════════════════════════════════
  log('\n══════════════════════════════════════════════════════');
  log('  PHASE C  V2 migration re-run bug');
  log('  Plant timeout="30" in offscreen localStorage, clear local, restart');
  log('  BEFORE fix: timeout=30 (dangerous). AFTER fix: timeout>=60 (safe).');
  log('══════════════════════════════════════════════════════');

  const browserC0 = await launchBrowser(SESSION_DIR, true);
  try {
    await getExtensionId(browserC0);
    await sleep(4000); // wait for extension + offscreen document to fully initialize

    // Simulate: the first V2 migration already ran successfully in a previous
    // session and wrote localStorageMigrated=true to chrome.storage.sync.
    // This is the state every V2→V3 user is in after their first startup.
    log('  Simulating completed V2 migration: setting localStorageMigrated=true in sync...');
    await evalInSW(browserC0, `chrome.storage.sync.set({ localStorageMigrated: true })`);
    await sleep(300);

    // Plant fake old-V2 data in the offscreen document's localStorage.
    // The key prefix matches what offscreenDocument.ts reads:
    //   `store.tabSuspenderSettings.<key>`
    // "active" must be present so the migration body actually executes.
    log('  Planting fake V2 data in offscreen localStorage...');
    await setOffscreenLocalStorage(browserC0, {
      'store.tabSuspenderSettings.timeout': '30',
      'store.tabSuspenderSettings.active':  'true',
    });
    log('  Offscreen localStorage: timeout="30", active="true" written');

    // Clear chrome.storage.local — simulates local storage corruption.
    // localStorageMigrated disappears from local, but sync still has it = true.
    log('  Clearing chrome.storage.local (simulates corruption)...');
    await clearLocalStorage(browserC0);
    log('  Local storage cleared. Sync still has localStorageMigrated=true.');

    await browserC0.close();
    await sleep(1000);
  } catch (e) {
    await browserC0.close().catch(() => {});
    throw e;
  }

  const browserC = await launchBrowser(SESSION_DIR, true);
  log('Browser restarted for Phase C check');
  try {
    await sleep(10000); // let extension initialize and run initOrMigrateSettings

    await getExtensionId(browserC);

    const settingsC = await getAllRelevantSettings(browserC);
    log(`  Settings after V2 re-migration: ${JSON.stringify(settingsC)}`);
    const timeoutC = settingsC['timeout'] as number;

    log(`  V2 re-migration result: timeout=${timeoutC}s ${timeoutC === 30 ? '✗ BUG: migration re-ran!' : '✓ migration skipped (fix in place)'}`);

    // Core regression guard: timeout must be safe.
    // FAILS before the fix (timeout=30 < 60), PASSES after the fix.
    runner.assert(
      typeof timeoutC === 'number' && timeoutC >= MIN_SAFE_TIMEOUT_S,
      `Phase-C: timeout safe after V2 re-migration — got ${timeoutC}s, need ≥${MIN_SAFE_TIMEOUT_S}s`,
    );

    log(`\n  Verdict: timeout=${timeoutC}s — ${
      timeoutC === 30                 ? '✗ BUG: V2 migration re-ran and corrupted timeout!' :
      timeoutC >= MIN_SAFE_TIMEOUT_S  ? '✓ safe (fix is in place)' :
                                        '✗ DANGEROUS — unexpected small value!'
    }`);

    await browserC.close();
  } catch (e) {
    await browserC.close().catch(() => {});
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
