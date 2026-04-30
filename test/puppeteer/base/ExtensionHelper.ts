import type { Browser } from 'puppeteer';
import type { ChromeTab, TabInfosMap } from './types.js';
import { sleep } from './BrowserHelper.js';

// Evaluate a JS expression in the extension's service worker context via CDP.
// The expression may be async (wrap it in an IIFE if needed).
export async function evalInSW<T = unknown>(browser: Browser, expression: string): Promise<T> {
  const target = browser.targets().find(
    t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
  );
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

export async function getExtensionId(browser: Browser, maxWaitMs = 20000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const target = browser.targets().find(
      t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );
    if (target) return target.url().split('/')[2];
    await sleep(1000);
  }
  throw new Error('Extension service worker not found within timeout');
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
