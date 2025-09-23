/**
 * Session Restore Detector - Waits for Chrome's session restore to complete
 * Prevents grouped tabs from becoming blank during browser startup
 */

interface SessionRestoreOptions {
	maxChecks?: number;
	checkInterval?: number;
	parkUrl?: string;
}

interface TabIndicators {
	hasNormalTabs: boolean;
	hasGroupedTabs: boolean;
	hasNewTabPages: number;
	totalTabs: number;
	hasLoadingTabs: number;
	hasCompleteNonParkTabs: number;
}

class SessionRestoreDetector {
	private static readonly DEFAULT_OPTIONS: Required<SessionRestoreOptions> = {
		maxChecks: 50, // Maximum 5 seconds (50 * 100ms)
		checkInterval: 100, // Check every 100ms
		parkUrl: 'chrome-extension://'
	};

	/**
	 * Wait for Chrome's session restore to complete before processing tabs.
	 * This prevents grouped tabs from becoming blank during browser startup.
	 */
	static waitForGroupRestore(options: SessionRestoreOptions = {}): Promise<void> {
		const opts = { ...SessionRestoreDetector.DEFAULT_OPTIONS, ...options };

		return new Promise(resolve => {
			let checkCount = 0;
			let previousTabCount = -1;
			let stableChecks = 0; // Count of checks where tab count was stable

			const checkGroupRestoreStatus = () => {
				checkCount++;

				chrome.tabs.query({}, (tabs) => {
					if (chrome.runtime.lastError) {
						console.warn('Error querying tabs during group restore check:', chrome.runtime.lastError);
						resolve(); // Continue anyway
						return;
					}

					// Track stability of tab count
					if (previousTabCount === tabs.length) {
						stableChecks++;
					} else {
						stableChecks = 0; // Reset if tab count changed
					}
					previousTabCount = tabs.length;

					// Analyze current tab state
					const indicators = SessionRestoreDetector.analyzeTabState(tabs, opts.parkUrl);

					// Check if we should proceed with tab processing
					const shouldProceed = SessionRestoreDetector.shouldProceedWithProcessing(
						indicators,
						checkCount,
						stableChecks,
						opts
					);

					if (shouldProceed) {
						const timing = checkCount * opts.checkInterval;
						SessionRestoreDetector.logCompletionReason(
							indicators,
							checkCount,
							stableChecks,
							timing,
							opts
						);
						resolve();
					} else {
						setTimeout(checkGroupRestoreStatus, opts.checkInterval);
					}
				});
			};

			// Start checking after a brief initial delay
			setTimeout(checkGroupRestoreStatus, 500);
		});
	}

	/**
	 * Analyze the current state of tabs to determine restore progress
	 */
	static analyzeTabState(tabs: chrome.tabs.Tab[], parkUrl: string): TabIndicators {
		const indicators: TabIndicators = {
			hasNormalTabs: false,
			hasGroupedTabs: false,
			hasNewTabPages: 0,
			totalTabs: tabs.length,
			hasLoadingTabs: 0,
			hasCompleteNonParkTabs: 0
		};

		for (const tab of tabs) {
			if (tab.url === 'chrome://newtab/' || tab.url === 'about:newtab') {
				indicators.hasNewTabPages++;
			} else if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith(parkUrl)) {
				indicators.hasNormalTabs = true;
				if (tab.status === 'complete') {
					indicators.hasCompleteNonParkTabs++;
				} else if (tab.status === 'loading') {
					indicators.hasLoadingTabs++;
				}
				if (tab.groupId !== -1) {
					indicators.hasGroupedTabs = true;
				}
			}
		}

		return indicators;
	}

	/**
	 * Determine if we should proceed with tab processing based on current state
	 */
	static shouldProceedWithProcessing(
		indicators: TabIndicators,
		checkCount: number,
		stableChecks: number,
		options: Required<SessionRestoreOptions>
	): boolean {
		// Calculate detection criteria
		const newTabRatio = indicators.hasNewTabPages / Math.max(indicators.totalTabs, 1);
		const hasContent = indicators.hasNormalTabs;
		const waitedMinimum = checkCount >= 10;
		const waitedReasonable = checkCount >= 20; // 2 seconds
		const waitedLong = checkCount >= 40; // 4 seconds
		const tabCountStable = stableChecks >= 5; // Tab count stable for 500ms
		const hasCompleteTabs = indicators.hasCompleteNonParkTabs > 0;
		const mostTabsLoaded = indicators.hasLoadingTabs <= Math.max(1, indicators.totalTabs * 0.3);

		// Progressive detection criteria - becomes more permissive over time
		return (
			// Ideal case: good content ratio + minimum wait + stable
			(hasContent && newTabRatio < 0.5 && waitedMinimum && tabCountStable) ||
			// Good case: has complete tabs + stable + reasonable wait
			(hasCompleteTabs && tabCountStable && waitedReasonable && mostTabsLoaded) ||
			// Fallback 1: has content + reasonable wait (ignore ratio)
			(hasContent && waitedReasonable && tabCountStable) ||
			// Fallback 2: waited long enough with some content
			(hasContent && waitedLong) ||
			// Fallback 3: waited very long regardless of content
			waitedLong ||
			// Absolute fallback: timeout
			checkCount >= options.maxChecks
		);
	}

	/**
	 * Log the reason why processing was started
	 */
	static logCompletionReason(
		indicators: TabIndicators,
		checkCount: number,
		stableChecks: number,
		timing: number,
		options: Required<SessionRestoreOptions>
	): void {
		const newTabRatio = indicators.hasNewTabPages / Math.max(indicators.totalTabs, 1);
		const hasContent = indicators.hasNormalTabs;
		const waitedMinimum = checkCount >= 10;
		const waitedReasonable = checkCount >= 20;
		const waitedLong = checkCount >= 40;
		const tabCountStable = stableChecks >= 5;
		const hasCompleteTabs = indicators.hasCompleteNonParkTabs > 0;
		const mostTabsLoaded = indicators.hasLoadingTabs <= Math.max(1, indicators.totalTabs * 0.3);

		if (checkCount >= options.maxChecks) {
			console.warn('Group restore check timed out after', timing, 'ms');
		} else if (hasContent && newTabRatio < 0.5 && waitedMinimum && tabCountStable) {
			console.log(`Session restore complete after ${timing}ms (optimal: ratio=${newTabRatio.toFixed(2)}, stable=${tabCountStable})`);
		} else if (hasCompleteTabs && tabCountStable && waitedReasonable && mostTabsLoaded) {
			console.log(`Session restore complete after ${timing}ms (good: ${indicators.hasCompleteNonParkTabs} complete tabs, stable)`);
		} else if (hasContent && waitedLong) {
			console.log(`Session restore proceeding after ${timing}ms (fallback: has content, long wait)`);
		} else {
			console.log(`Session restore proceeding after ${timing}ms (fallback conditions met)`);
		}
	}
}

if (typeof module != 'undefined')
	module.exports = {
		SessionRestoreDetector
	}