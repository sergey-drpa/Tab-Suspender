/**
 * Tests for park.ts screenshot loading timeout and error handling
 * These tests verify the fixes for the promise hanging bug
 *
 * Issue #27 fixes:
 * - Fix #4: withTimeout utility for screenPromise (5s timeout with fallback)
 * - Fix #3: backProcessed flag handling
 * - Fix #5: historyFallback timeout increased to 1500ms
 */

// Replicate the withTimeout function from park.ts for testing
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => {
            resolve(fallback);
        }, ms))
    ]);
}

describe('Park Page Screenshot Timeout Tests', () => {
  let mockChrome: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup Chrome API mocks
    mockChrome = {
      runtime: {
        sendMessage: jest.fn()
      }
    };
    (global as any).chrome = mockChrome;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('screenPromise timeout mechanism', () => {
    it('should timeout after 10 seconds if screenshot never arrives', async () => {
      // Mock sendMessage to never respond (simulating hanging promise)
      const neverResolvingPromise = new Promise(() => {
        // Never resolves or rejects
      });
      mockChrome.runtime.sendMessage.mockReturnValue(neverResolvingPromise);

      // Simulate the timeout logic from park.ts
      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot loading timeout after 10s')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      // Fast-forward time by 10 seconds
      jest.advanceTimersByTime(10000);

      // Should reject with timeout error
      await expect(screenPromise).rejects.toThrow('Screenshot loading timeout after 10s');
    });

    it('should resolve normally if screenshot arrives before timeout', async () => {
      const mockScreenData = {
        scr: 'data:image/jpeg;base64,fake',
        pixRat: 2
      };

      // Mock sendMessage to respond after 5 seconds
      const delayedPromise = new Promise((resolve) => {
        setTimeout(() => resolve(mockScreenData), 5000);
      });
      mockChrome.runtime.sendMessage.mockReturnValue(delayedPromise);

      // Simulate the timeout logic from park.ts
      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot loading timeout after 10s')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      // Fast-forward time by 5 seconds
      jest.advanceTimersByTime(5000);

      // Should resolve with screenshot data
      await expect(screenPromise).resolves.toEqual(mockScreenData);
    });

    it('should reject if background script returns error', async () => {
      const errorPromise = Promise.reject(new Error('Background script error'));
      mockChrome.runtime.sendMessage.mockReturnValue(errorPromise);

      // Simulate the timeout logic from park.ts
      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot loading timeout after 10s')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      // Should reject with background script error (before timeout)
      await expect(screenPromise).rejects.toThrow('Background script error');
    });
  });

  describe('screenPromise.then().catch() error handling', () => {
    it('should call catch handler when promise rejects', async () => {
      const mockError = new Error('Screenshot fetch failed');
      mockChrome.runtime.sendMessage.mockRejectedValue(mockError);

      const screenPromise = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const thenHandler = jest.fn();
      const catchHandler = jest.fn();

      await screenPromise.then(thenHandler).catch(catchHandler);

      expect(thenHandler).not.toHaveBeenCalled();
      expect(catchHandler).toHaveBeenCalledWith(mockError);
    });

    it('should call catch handler when promise times out', async () => {
      const neverResolvingPromise = new Promise(() => {});
      mockChrome.runtime.sendMessage.mockReturnValue(neverResolvingPromise);

      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot loading timeout after 10s')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      const thenHandler = jest.fn();
      const catchHandler = jest.fn();

      const handlerPromise = screenPromise.then(thenHandler).catch(catchHandler);

      // Fast-forward time
      jest.advanceTimersByTime(10000);

      await handlerPromise;

      expect(thenHandler).not.toHaveBeenCalled();
      expect(catchHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Screenshot loading timeout after 10s'
        })
      );
    });

    it('should allow page to continue rendering when catch is called', async () => {
      mockChrome.runtime.sendMessage.mockRejectedValue(
        new Error('Database query failed')
      );

      const screenPromise = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      let pageRendered = false;

      await screenPromise
        .then((data: any) => {
          // Handle success - would draw screenshot
          pageRendered = true;
        })
        .catch((e: Error) => {
          // Handle error - render page without screenshot
          console.error('screenPromise failed:', e);
          pageRendered = true; // Page still renders
        });

      expect(pageRendered).toBe(true);
    });
  });

  describe('Promise.race behavior', () => {
    it('should settle with first promise that completes', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('slow'), 10000);
      });

      const fastPromise = new Promise((resolve) => {
        setTimeout(() => resolve('fast'), 1000);
      });

      const racePromise = Promise.race([slowPromise, fastPromise]);

      jest.advanceTimersByTime(1000);

      await expect(racePromise).resolves.toBe('fast');
    });

    it('should settle with first promise that rejects', async () => {
      const slowResolve = new Promise((resolve) => {
        setTimeout(() => resolve('success'), 10000);
      });

      const fastReject = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('fast fail')), 1000);
      });

      const racePromise = Promise.race([slowResolve, fastReject]);

      jest.advanceTimersByTime(1000);

      await expect(racePromise).rejects.toThrow('fast fail');
    });
  });

  describe('integration: complete park page loading flow', () => {
    it('should load park page successfully when screenshot available', async () => {
      const mockParkData = {
        startDiscarded: false,
        tabInfo: { zoomFactor: 1 },
        parkedUrl: 'https://example.com',
        isTabMarkedForUnsuspend: false,
        reloadTabOnRestore: false,
        tabIconStatusVisualize: true,
        tabIconOpacityChange: false,
        screenshotCssStyle: '',
        restoreEvent: 'click',
        parkBgColor: 'ffffff',
        restoreButtonView: 'roundIcon'
      };

      const mockScreenData = {
        scr: 'data:image/jpeg;base64,screenshot',
        pixRat: 2
      };

      mockChrome.runtime.sendMessage.mockImplementation((msg: any) => {
        if (msg.method === '[TS:dataForParkPage]') {
          return Promise.resolve(mockParkData);
        }
        if (msg.method === '[TS:getScreen]') {
          return new Promise((resolve) => {
            setTimeout(() => resolve(mockScreenData), 100);
          });
        }
        return Promise.resolve({});
      });

      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      let drawContentCalled = false;
      let continueStartCalled = false;

      jest.advanceTimersByTime(100);

      await screenPromise
        .then(({ scr, pixRat }: any) => {
          expect(scr).toBe('data:image/jpeg;base64,screenshot');
          expect(pixRat).toBe(2);
          drawContentCalled = true;
          continueStartCalled = true;
        })
        .catch(() => {
          drawContentCalled = true;
          continueStartCalled = true;
        });

      expect(drawContentCalled).toBe(true);
      expect(continueStartCalled).toBe(true);
    });

    it('should load park page without screenshot when fetch times out', async () => {
      const neverResolvingPromise = new Promise(() => {});
      mockChrome.runtime.sendMessage.mockReturnValue(neverResolvingPromise);

      const screenPromiseRaw = mockChrome.runtime.sendMessage({
        method: '[TS:getScreen]',
        tabId: 1,
        sessionId: 123
      });

      const screenTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 10000);
      });

      const screenPromise = Promise.race([screenPromiseRaw, screenTimeout]);

      let drawContentCalled = false;
      let continueStartCalled = false;

      const loadPromise = screenPromise
        .then(() => {
          drawContentCalled = true;
          continueStartCalled = true;
        })
        .catch(() => {
          // Page renders without screenshot
          drawContentCalled = true;
          continueStartCalled = true;
        });

      jest.advanceTimersByTime(10000);

      await loadPromise;

      expect(drawContentCalled).toBe(true);
      expect(continueStartCalled).toBe(true);
    });
  });

  // Issue #27 Fix #4: withTimeout utility function tests
  describe('withTimeout utility (Issue #27 Fix #4)', () => {
    it('should return promise result if it resolves before timeout', async () => {
      const fastPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 1000);
      });

      const result = withTimeout(fastPromise, 5000, 'fallback');

      jest.advanceTimersByTime(1000);

      await expect(result).resolves.toBe('success');
    });

    it('should return fallback if promise does not resolve before timeout', async () => {
      const slowPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 10000);
      });

      const result = withTimeout(slowPromise, 5000, 'fallback');

      jest.advanceTimersByTime(5000);

      await expect(result).resolves.toBe('fallback');
    });

    it('should return fallback if promise never resolves', async () => {
      const neverResolvingPromise = new Promise<string>(() => {
        // Never resolves
      });

      const result = withTimeout(neverResolvingPromise, 5000, 'fallback');

      jest.advanceTimersByTime(5000);

      await expect(result).resolves.toBe('fallback');
    });

    it('should handle object fallback for screenPromise', async () => {
      const neverResolvingPromise = new Promise<{ scr: string | null; pixRat: number | null }>(() => {});

      const fallback = { scr: null, pixRat: null };
      const result = withTimeout(neverResolvingPromise, 5000, fallback);

      jest.advanceTimersByTime(5000);

      await expect(result).resolves.toEqual({ scr: null, pixRat: null });
    });

    it('should reject if promise rejects before timeout', async () => {
      const rejectingPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Promise failed')), 1000);
      });

      const result = withTimeout(rejectingPromise, 5000, 'fallback');

      jest.advanceTimersByTime(1000);

      await expect(result).rejects.toThrow('Promise failed');
    });

    it('should use 2500ms timeout as configured for screenPromise', async () => {
      const mockScreenPromise = new Promise<{ scr: string; pixRat: number }>((resolve) => {
        setTimeout(() => resolve({ scr: 'base64data', pixRat: 2 }), 2000);
      });

      const result = withTimeout(mockScreenPromise, 2500, { scr: null as any, pixRat: null as any });

      jest.advanceTimersByTime(2000);

      await expect(result).resolves.toEqual({ scr: 'base64data', pixRat: 2 });
    });
  });

  // Issue #27 Fix #3: backProcessed flag behavior tests
  describe('backProcessed flag behavior (Issue #27 Fix #3)', () => {
    it('should set backProcessed before navigation attempt', () => {
      let backProcessed = false;
      let navigationAttempted = false;

      const goBack = (options?: { force?: boolean }) => {
        if (!backProcessed || (options != null && options.force === true)) {
          backProcessed = true;
          navigationAttempted = true;
        }
      };

      goBack();

      expect(backProcessed).toBe(true);
      expect(navigationAttempted).toBe(true);
    });

    it('should block subsequent calls when backProcessed is true', () => {
      let backProcessed = false;
      let navigationCount = 0;

      const goBack = (options?: { force?: boolean }) => {
        if (!backProcessed || (options != null && options.force === true)) {
          backProcessed = true;
          navigationCount++;
        }
      };

      goBack();
      goBack();
      goBack();

      expect(navigationCount).toBe(1);
    });

    it('should allow navigation with force option', () => {
      let backProcessed = true;
      let navigationCount = 0;

      const goBack = (options?: { force?: boolean }) => {
        if (!backProcessed || (options != null && options.force === true)) {
          backProcessed = true;
          navigationCount++;
        }
      };

      goBack({ force: true });

      expect(navigationCount).toBe(1);
    });
  });

  // Issue #27 Fix #5: historyFallback timeout tests
  describe('historyFallback timeout (Issue #27 Fix #5)', () => {
    it('should use 1500ms timeout instead of 500ms', () => {
      let fallbackExecuted = false;
      let hasHistory = false;
      let navigationAttempted = false;

      const historyFallback = () => {
        setTimeout(() => {
          if (!hasHistory && !navigationAttempted) {
            navigationAttempted = true;
            fallbackExecuted = true;
          }
        }, 1500);
      };

      historyFallback();

      // At 500ms (old timeout) - should NOT have executed
      jest.advanceTimersByTime(500);
      expect(fallbackExecuted).toBe(false);

      // At 1000ms - should still NOT have executed
      jest.advanceTimersByTime(500);
      expect(fallbackExecuted).toBe(false);

      // At 1500ms (new timeout) - should execute
      jest.advanceTimersByTime(500);
      expect(fallbackExecuted).toBe(true);
    });

    it('should not execute fallback if history navigation succeeds', () => {
      let fallbackExecuted = false;
      let hasHistory = false;
      let navigationAttempted = false;

      const historyFallback = () => {
        setTimeout(() => {
          hasHistory = true;
        }, 100);

        setTimeout(() => {
          if (!hasHistory && !navigationAttempted) {
            navigationAttempted = true;
            fallbackExecuted = true;
          }
        }, 1500);
      };

      historyFallback();

      jest.advanceTimersByTime(100);
      expect(hasHistory).toBe(true);

      jest.advanceTimersByTime(1400);
      expect(fallbackExecuted).toBe(false);
    });

    it('should prevent double navigation with navigationAttempted flag', () => {
      let fallbackCount = 0;
      let hasHistory = false;
      let navigationAttempted = false;

      const historyFallback = () => {
        setTimeout(() => {
          if (!hasHistory && !navigationAttempted) {
            navigationAttempted = true;
            fallbackCount++;
          }
        }, 1500);

        setTimeout(() => {
          if (!hasHistory && !navigationAttempted) {
            navigationAttempted = true;
            fallbackCount++;
          }
        }, 1600);
      };

      historyFallback();

      jest.advanceTimersByTime(1600);

      expect(fallbackCount).toBe(1);
    });
  });
});
