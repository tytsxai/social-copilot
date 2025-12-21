export interface NormalizeBaseUrlOptions {
  allowInsecureHttp?: boolean;
  allowPrivateHosts?: boolean;
}

function isPrivateOrLocalAddress(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (!host) return false;

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  if (host === 'localhost') return true;
  if (host === '::1') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((s) => Number.parseInt(s, 10));
    if (octets.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) return true;

    const [a, b] = octets;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 0) return true; // 0.0.0.0/8 (incl 0.0.0.0)
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    return false;
  }

  // Basic IPv6 local/private checks without DNS resolution.
  // - fc00::/7 (Unique Local Address)
  // - fe80::/10 (Link-local)
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true;

  return false;
}

export function normalizeBaseUrl(input: string, options: NormalizeBaseUrlOptions = {}): string {
  let baseUrl = input.trim();
  if (!baseUrl) return baseUrl;

  // Normalize trailing slashes first.
  baseUrl = baseUrl.replace(/\/+$/g, '');

  // Users often paste full API URLs that include `/v1` (or deeper like `/v1/chat/completions`).
  // Providers append `/v1/...` themselves, so strip the `/v1` segment and anything after it.
  baseUrl = baseUrl.replace(/\/v1(?:\/.*)?$/i, '');
  baseUrl = baseUrl.replace(/\/+$/g, '');

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid baseUrl: ${baseUrl}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(options.allowInsecureHttp && protocol === 'http:')) {
    throw new Error('baseUrl must use https:// (or set allowInsecureHttp: true)');
  }

  if (!options.allowPrivateHosts && isPrivateOrLocalAddress(parsed.hostname)) {
    throw new Error('baseUrl must not target localhost or private IP ranges (or set allowPrivateHosts: true)');
  }

  return baseUrl;
}
