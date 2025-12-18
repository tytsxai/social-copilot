import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries on configured status and respects Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '1' },
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithTimeout('https://example.com', {
      retry: { retries: 1, baseDelayMs: 0, maxDelayMs: 5000 },
      timeoutMs: 5000,
    });

    // First attempt happens immediately (no timers should be advanced, since that
    // would also advance the retry delay/timeout timers).
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Retry should wait at least Retry-After (1s).
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    const response = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('retries on network error (TypeError) when configured', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithTimeout('https://example.com', {
      retry: { retries: 1, baseDelayMs: 0, maxDelayMs: 5000 },
      timeoutMs: 5000,
    });

    await vi.runAllTimersAsync();
    const response = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(true);
  });
});
