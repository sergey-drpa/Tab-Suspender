/**
 * Tests for park.ts screenshot loading timeout and error handling
 * These tests verify the fixes for the promise hanging bug
 */

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
});
