import type { Browser, Page, CDPSession, Target } from 'puppeteer';
import type { ChromeTab, TabInfosMap } from './types.js';
import { sleep } from './BrowserHelper.js';

// Remember which extension ID belongs to Tab Suspender per Browser instance.
const tsExtensionIdMap = new WeakMap<Browser, string>();
// Capture console events emitted by any service worker belonging to the extension.
interface SWLogCollector {
  lines: string[];
  sessions: CDPSession[];
  targets: Set<Target>;
  onTargetCreated?: (target: Target) => void;
}
const swLogCollectors = new WeakMap<Browser, SWLogCollector>();

function getSWTarget(browser: Browser) {
  const knownId = tsExtensionIdMap.get(browser);
  const targets = browser.targets().filter(
    t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
  );
  if (knownId) {
    return targets.find(t => t.url().includes(`chrome-extension://${knownId}/`)) ?? targets[0];
  }
  return targets[0];
}

function formatCDPConsoleEvent(target: Target, event: any): string {
  const text = (event.args || [])
    .map((a: any) => a.value != null ? String(a.value) : a.description != null ? a.description : '')
    .join(' ');
  return `[SW ${target.url()} ${event.type}] ${text}`;
}

async function attachSWTarget(browser: Browser, target: Target, collector: SWLogCollector): Promise<void> {
  if (collector.targets.has(target)) return;
  const session = await target.createCDPSession().catch(() => null);
  if (!session) return;
  await session.send('Runtime.enable').catch(() => {});
  session.on('Runtime.consoleAPICalled', (event: any) => {
    collector.lines.push(formatCDPConsoleEvent(target, event));
  });
  collector.sessions.push(session);
  collector.targets.add(target);
}

// Evaluate a JS expression in the extension's service worker context via CDP.
// The expression may be async (wrap it in an IIFE if needed).
export async function evalInSW<T = unknown>(browser: Browser, expression: string): Promise<T> {
  const target = getSWTarget(browser);
  if (!target) throw new Error('Extension service worker target not found');

  const session = await target.createCDPSession();
  try {
    const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(`CDP eval error: ${exceptionDetails.text ?? exceptionDetails.exception?.description}`);
    }
    return result.value as T;
  } finally {
    await session.detach();
  }
}

/**
 * Attach a CDP console listener to every Tab-Suspender service worker target
 * (including targets that appear later, e.g. after a session restore restart)
 * and return a function that detaches all sessions and returns the collected
 * lines. This should be called as early as possible after launching the browser
 * so startup logs are captured.
 */
export async function installSWLogCapture(browser: Browser): Promise<() => string[]> {
  const knownId = tsExtensionIdMap.get(browser);
  let collector = swLogCollectors.get(browser);
  if (!collector) {
    collector = { lines: [], sessions: [], targets: new Set<Target>() };
    swLogCollectors.set(browser, collector);
    const onTargetCreated = (target: Target) => {
      if (target.type() !== 'service_worker') return;
      const url = target.url();
      if (!url.includes('chrome-extension://')) return;
      if (knownId && !url.includes(`chrome-extension://${knownId}/`)) return;
      void attachSWTarget(browser, target, collector!);
    };
    collector.onTargetCreated = onTargetCreated;
    browser.on('targetcreated', onTargetCreated);
  }

  for (const target of browser.targets()) {
    if (target.type() !== 'service_worker') continue;
    const url = target.url();
    if (!url.includes('chrome-extension://')) continue;
    if (knownId && !url.includes(`chrome-extension://${knownId}/`)) continue;
    await attachSWTarget(browser, target, collector);
  }

  return async () => {
    if (collector!.onTargetCreated) {
      browser.off('targetcreated', collector!.onTargetCreated);
      collector!.onTargetCreated = undefined;
    }
    for (const session of collector!.sessions) {
      await session.detach().catch(() => {});
    }
    collector!.sessions = [];
    const id = tsExtensionIdMap.get(browser);
    if (!id) return collector!.lines;
    return collector!.lines.filter(line => line.includes(`chrome-extension://${id}/`));
  };
}

/**
 * Legacy CDP-based console collector. Kept for compatibility but the target-aware
 * capture is preferred because it catches startup logs across service worker
 * restarts.
 */
export function startSWConsoleCollection(browser: Browser): { stop: () => Promise<string[]> } {
  const lines: string[] = [];
  const target = getSWTarget(browser);
  if (!target) {
    return { stop: async () => lines };
  }

  let session: CDPSession | null = null;
  let detached = false;

  const attach = async () => {
    session = await target.createCDPSession();
    await session.send('Runtime.enable');
    session.on('Runtime.consoleAPICalled', (event: any) => {
      const text = (event.args || [])
        .map((a: any) => a.value != null ? String(a.value) : a.description != null ? a.description : '')
        .join(' ');
      lines.push(`[SW ${event.type}] ${text}`);
    });
  };

  void attach().catch((e: Error) => lines.push(`[SW attach error] ${e.message}`));

  return {
    stop: async () => {
      if (!detached && session) {
        detached = true;
        await session.detach().catch(() => {});
      }
      return lines;
    },
  };
}

export async function getExtensionId(browser: Browser, maxWaitMs = 20000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const targets = browser.targets().filter(
      t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );
    for (const target of targets) {
      const candidateId = target.url().split('/')[2];
      const session = await target.createCDPSession().catch(() => null);
      if (!session) continue;
      try {
        const { result } = await session.send('Runtime.evaluate', {
          expression: 'typeof whiteList',
          returnByValue: true,
        });
        if (result.value === 'object') {
          tsExtensionIdMap.set(browser, candidateId);
          return candidateId;
        }
      } catch {
        // ignore and try next target
      } finally {
        await session.detach().catch(() => {});
      }
    }
    await sleep(1000);
  }
  throw new Error('Tab Suspender service worker not found within timeout');
}

export function parkUrlPrefix(extensionId: string): string {
  return `chrome-extension://${extensionId}/park.html`;
}

export async function parkAllTabs(browser: Browser): Promise<void> {
  await evalInSW(browser, 'parkTabs()');
}

// Suspend a specific tab by its Chrome tab ID
export async function suspendTabById(browser: Browser, tabId: number): Promise<void> {
  await evalInSW(browser, `(async () => {
    const tab = await chrome.tabs.get(${tabId});
    if (tab) parkTab(tab, tab.id);
  })()`);
}

export async function discardTabById(browser: Browser, tabId: number): Promise<void> {
  await evalInSW(browser, `chrome.tabs.discard(${tabId})`);
}

export async function reloadTabById(browser: Browser, tabId: number): Promise<void> {
  await evalInSW(browser, `(async () => { await chrome.tabs.reload(${tabId}); })()`);
}

export async function queryChromeTabs(browser: Browser): Promise<ChromeTab[]> {
  const json = await evalInSW<string>(browser, `
    (async () => {
      const tabs = await chrome.tabs.query({});
      return JSON.stringify(tabs);
    })()`);
  return JSON.parse(json) as ChromeTab[];
}

// Returns the raw tabInfos object keyed by string tab-id.
// Fields use the _-prefixed names as they exist in the serialised TabInfo.
export async function getTabInfosCopy(browser: Browser): Promise<TabInfosMap> {
  const json = await evalInSW<string>(browser, 'JSON.stringify(tabManager.getTabInfosCopy())');
  return JSON.parse(json) as TabInfosMap;
}

export interface CleanupDiagnostics {
  chromeTabs: Array<{ id: number; url: string; discarded: boolean }>;
  tabInfosBefore: Record<string, { _closed: unknown; _newRefId: unknown; _oldRefId: unknown; _parked: unknown }>;
  markedAsClosed: string[];
  tabInfosAfter: Record<string, { _closed: unknown; _newRefId: unknown; _oldRefId: unknown; _parked: unknown }>;
}

// Force-clean stale tab-info entries without waiting for the 30-sec grace period.
// Marks every entry whose tab-id is NOT in Chrome's current tab list as closed, then
// runs clearClosedTabs() with TTL=0 so they are removed immediately.
// Returns a diagnostic snapshot showing chrome tabs and tabInfos state before/after.
export async function forceTabInfoCleanup(browser: Browser): Promise<CleanupDiagnostics> {
  const json = await evalInSW<string>(browser, `(async () => {
    tabManager.setTabInfoCleanupTtlMs(0);
    const currentTabs = await chrome.tabs.query({});
    const currentIds = new Set(currentTabs.map(t => String(t.id)));
    const infos = tabManager.tabInfos;

    const before = {};
    for (const id in infos) {
      if (infos[id]) {
        before[id] = {
          _closed: infos[id]._closed,
          _newRefId: infos[id]._newRefId,
          _oldRefId: infos[id]._oldRefId,
          _parked: infos[id]._parked,
        };
      }
    }

    const markedAsClosed = [];
    for (const id in infos) {
      if (infos[id] && !currentIds.has(id)) {
        const newRefId = infos[id]._newRefId;
        if (newRefId != null && currentIds.has(String(newRefId))) {
          // onTabReplaceDetected() stores the same TabInfo object under both keys.
          // Setting _closed here would also close the live replacement entry.
          // Delete only the stale key so the live tab's entry is unaffected.
          delete infos[id];
          markedAsClosed.push(id + '(direct)');
        } else if (infos[id]._closed == null) {
          infos[id]._closed = { at: Date.now() - 1, tsSessionId: 0 };
          markedAsClosed.push(id);
        }
      }
    }

    tabManager.clearClosedTabs();

    const after = {};
    const infosAfter = tabManager.tabInfos;
    for (const id in infosAfter) {
      if (infosAfter[id]) {
        after[id] = {
          _closed: infosAfter[id]._closed,
          _newRefId: infosAfter[id]._newRefId,
          _oldRefId: infosAfter[id]._oldRefId,
          _parked: infosAfter[id]._parked,
        };
      }
    }

    return JSON.stringify({
      chromeTabs: currentTabs.map(t => ({ id: t.id, url: t.url ? t.url.slice(0, 80) : '', discarded: t.discarded })),
      tabInfosBefore: before,
      markedAsClosed,
      tabInfosAfter: after,
    });
  })()`);
  return JSON.parse(json) as CleanupDiagnostics;
}

// Wait until at least `count` park.html pages appear in browser.pages()
export async function waitForParkPages(
  browser: Browser,
  extensionId: string,
  count: number,
  timeoutMs = 30000,
): Promise<void> {
  const prefix = parkUrlPrefix(extensionId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = await browser.pages();
    if (pages.filter(p => p.url().startsWith(prefix)).length >= count) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${count} park pages`);
}

export async function getParkPages(browser: Browser, extensionId: string) {
  const prefix = parkUrlPrefix(extensionId);
  const pages = await browser.pages();
  return pages.filter(p => p.url().startsWith(prefix));
}

export async function getParkPageByTabId(browser: Browser, extensionId: string, tabId: number | string): Promise<Page | null> {
  const pages = await getParkPages(browser, extensionId);
  const needle = `tabId=${tabId}`;
  return pages.find(p => p.url().includes(needle)) ?? null;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getSetting(browser: Browser, key: string): Promise<unknown> {
  return evalInSW(browser, `settings.get(${JSON.stringify(key)})`);
}

export async function setSetting(browser: Browser, key: string, value: unknown): Promise<void> {
  await evalInSW(browser, `settings.set(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
  await sleep(400);
}

// ─── Tab restore helpers ──────────────────────────────────────────────────────

export async function unsuspendTabById(browser: Browser, tabId: number): Promise<void> {
  await evalInSW(browser, `(async () => {
    const tab = await chrome.tabs.get(${tabId}).catch(() => null);
    if (tab) tabManager.unsuspendTab(tab);
  })()`);
}

// Poll until the tab's URL no longer contains the park page prefix.
// Returns the restored URL.
export async function waitForTabToRestore(
  browser: Browser,
  tabId: number,
  timeoutMs = 25000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await evalInSW<string>(browser, `(async () => {
      const tab = await chrome.tabs.get(${tabId}).catch(() => null);
      return JSON.stringify(tab ? { url: tab.url, discarded: tab.discarded } : null);
    })()`);
    if (json) {
      const tab = JSON.parse(json);
      if (tab && tab.url && !tab.url.includes('park.html')) return tab.url as string;
    }
    await sleep(500);
  }
  throw new Error(`Tab ${tabId} did not leave park page within ${timeoutMs}ms`);
}

// Poll until ANY chrome tab whose URL currently includes `urlPart` (case-sensitive).
// Returns the matching ChromeTab.
export async function waitForAnyTabWithUrl(
  browser: Browser,
  urlPart: string,
  timeoutMs = 25000,
): Promise<ChromeTab> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await queryChromeTabs(browser);
    const found = tabs.find(t => t.url && t.url.includes(urlPart));
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`No tab with URL containing "${urlPart}" found within ${timeoutMs}ms`);
}

// Wait until a tab with the given ID is no longer on park.html and return its URL.
// Falls back to searching by any park.html tab if tabId is not found (handles ID reassignment).
export async function waitForAnyTabToLeaveParked(
  browser: Browser,
  extensionId: string,
  expectedOriginalUrlPart: string,
  timeoutMs = 25000,
): Promise<string> {
  const prefix = parkUrlPrefix(extensionId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await queryChromeTabs(browser);
    const found = tabs.find(t => t.url && t.url.includes(expectedOriginalUrlPart) && !t.url.startsWith(prefix));
    if (found) return found.url;
    await sleep(500);
  }
  throw new Error(`No tab navigated to "${expectedOriginalUrlPart}" within ${timeoutMs}ms`);
}

// Poll until the SW's async init() has assigned whiteList, ignoreList, and tabManager.
// These are top-level `let` variables populated asynchronously; calling them too early
// returns undefined.
export async function waitForExtensionInit(browser: Browser, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const type = await evalInSW<string>(browser, 'typeof whiteList').catch(() => 'undefined');
    if (type === 'object') return;
    await sleep(500);
  }
  throw new Error('Extension SW did not fully initialize (whiteList still undefined) within timeout');
}

// Wraps evalInSW so a failed eval returns null instead of throwing.
export async function safeEvalInSW<T = unknown>(
  browser: Browser,
  expr: string,
): Promise<T | null> {
  try {
    return await evalInSW<T>(browser, expr);
  } catch (_e) {
    return null;
  }
}
