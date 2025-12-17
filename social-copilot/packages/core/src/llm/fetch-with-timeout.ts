const DEFAULT_TIMEOUT_MS = 20_000;

export interface FetchRetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Retry on these HTTP statuses (commonly 429, 5xx).
   * Defaults to [429, 500, 502, 503, 504].
   */
  retryOnStatuses?: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(250, baseDelayMs));
  return Math.min(maxDelayMs, exp + jitter);
}

/**
 * Fetch helper with AbortController-based timeout protection.
 */
export async function fetchWithTimeout(
  resource: string,
  options: RequestInit & { timeoutMs?: number; retry?: FetchRetryOptions }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retry, signal: upstreamSignal, ...requestInit } = options;
  const retries = retry?.retries ?? 0;
  const baseDelayMs = retry?.baseDelayMs ?? 500;
  const maxDelayMs = retry?.maxDelayMs ?? 5000;
  const retryOnStatuses = retry?.retryOnStatuses ?? [429, 500, 502, 503, 504];

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onUpstreamAbort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort();
      } else {
        upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
      }
    }

    try {
      const response = await fetch(resource, { ...requestInit, signal: controller.signal });
      if (response.ok) return response;

      if (attempt >= retries || !retryOnStatuses.includes(response.status)) {
        return response;
      }

      const delay = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
      continue;
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        if (!timedOut) throw error;
        if (attempt >= retries) {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        const delay = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', onUpstreamAbort);
    }
  }

  // Unreachable, but keep TS happy.
  throw new Error('fetchWithTimeout: unreachable');
}
