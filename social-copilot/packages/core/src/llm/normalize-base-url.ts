export function normalizeBaseUrl(input: string): string {
  let baseUrl = input.trim();
  if (!baseUrl) return baseUrl;

  // Normalize trailing slashes first.
  baseUrl = baseUrl.replace(/\/+$/g, '');

  // Users often paste full API URLs that include `/v1` (or deeper like `/v1/chat/completions`).
  // Providers append `/v1/...` themselves, so strip the `/v1` segment and anything after it.
  baseUrl = baseUrl.replace(/\/v1(?:\/.*)?$/i, '');
  baseUrl = baseUrl.replace(/\/+$/g, '');

  return baseUrl;
}
