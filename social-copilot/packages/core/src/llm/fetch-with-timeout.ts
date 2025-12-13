const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Fetch helper with AbortController-based timeout protection.
 */
export async function fetchWithTimeout(
  resource: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    return response;
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
