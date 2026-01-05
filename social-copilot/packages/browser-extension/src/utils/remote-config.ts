import { debugError, debugLog } from './debug';
import { storageLocalGet, storageLocalSet } from './webext';

export interface SelectorConfig {
  version: number;
  platforms: {
    whatsapp?: {
      legacy?: Record<string, string>;
      testid?: Record<string, string>;
    };
    telegram?: Record<string, string>;
    slack?: Record<string, string>;
  };
}

export interface RemoteSelectorsStatus {
  lastAttemptAt?: number;
  lastFetchedAt?: number;
  lastUrl?: string;
  lastVersion?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

export interface RemoteSelectorsDiagnostics {
  configured: boolean;
  url?: string;
  lastAttemptAt?: number;
  lastFetchedAt?: number;
  lastUrl?: string;
  lastVersion?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

const REMOTE_SELECTORS_URL_STORAGE_KEY = 'remoteSelectorsUrl';
const STORAGE_KEY = 'remote_selector_config';
const STATUS_STORAGE_KEY = 'remote_selector_status';
const CACHE_DURATION_MS = 1000 * 60 * 60 * 24; // 24小时缓存
const FETCH_TIMEOUT_MS = 7000;

const MAX_REMOTE_CONFIG_BYTES = 100_000;
const MAX_SELECTOR_ENTRIES = 120;
const MAX_SELECTOR_KEY_LENGTH = 64;
const MAX_SELECTOR_VALUE_LENGTH = 400;
const MAX_STATUS_ERROR_LENGTH = 240;
const MAX_REF_SEGMENT_LENGTH = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  if (!isPlainRecord(value)) return null;
  const result: Record<string, string> = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (kept >= MAX_SELECTOR_ENTRIES) break;
    if (typeof key !== 'string') continue;
    if (key.length === 0 || key.length > MAX_SELECTOR_KEY_LENGTH) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_SELECTOR_VALUE_LENGTH) continue;
      if (/\r|\n/.test(trimmed)) continue;
      result[key] = trimmed;
      kept += 1;
    }
  }
  return Object.keys(result).length ? result : null;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStatusError(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_STATUS_ERROR_LENGTH ? trimmed.slice(0, MAX_STATUS_ERROR_LENGTH) : trimmed;
}

function normalizeRemoteStatus(raw: unknown): RemoteSelectorsStatus | null {
  if (!isPlainRecord(raw)) return null;
  const lastAttemptAt = normalizeOptionalNumber(raw.lastAttemptAt);
  const lastFetchedAt = normalizeOptionalNumber(raw.lastFetchedAt);
  const lastUrl = normalizeOptionalString(raw.lastUrl);
  const lastVersion = normalizeOptionalNumber(raw.lastVersion);
  const lastStatus = raw.lastStatus === 'ok' || raw.lastStatus === 'error' ? raw.lastStatus : undefined;
  const lastError = normalizeStatusError(raw.lastError);
  if (!lastAttemptAt && !lastFetchedAt && !lastUrl && !lastVersion && !lastStatus && !lastError) return null;
  return {
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(lastFetchedAt !== undefined ? { lastFetchedAt } : {}),
    ...(lastUrl ? { lastUrl } : {}),
    ...(lastVersion !== undefined ? { lastVersion } : {}),
    ...(lastStatus ? { lastStatus } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function isValidRefSegment(value: string): boolean {
  if (!value || value.length > MAX_REF_SEGMENT_LENGTH) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function parseSelectorConfig(raw: unknown): SelectorConfig | null {
  if (!isPlainRecord(raw)) return null;

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;

  const platformsRaw = raw.platforms;
  if (!isPlainRecord(platformsRaw)) return null;

  const platforms: SelectorConfig['platforms'] = {};

  const whatsappRaw = platformsRaw.whatsapp;
  if (isPlainRecord(whatsappRaw)) {
    const legacy = normalizeStringRecord(whatsappRaw.legacy);
    const testid = normalizeStringRecord(whatsappRaw.testid);
    if (legacy || testid) {
      platforms.whatsapp = {
        ...(legacy ? { legacy } : {}),
        ...(testid ? { testid } : {}),
      };
    }
  }

  const telegram = normalizeStringRecord(platformsRaw.telegram);
  if (telegram) platforms.telegram = telegram;

  const slack = normalizeStringRecord(platformsRaw.slack);
  if (slack) platforms.slack = slack;

  return { version, platforms };
}

export function validateRemoteSelectorsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'raw.githubusercontent.com') return null;
  const pathname = url.pathname;
  if (!pathname.endsWith('/selectors.json')) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 4) return null;
  const ref = segments[2];
  if (!isValidRefSegment(ref)) return null;
  const owner = segments[0];
  const repo = segments[1];
  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return url.toString();
}

async function updateRemoteSelectorsStatus(update: Partial<RemoteSelectorsStatus>): Promise<void> {
  try {
    const stored = await storageLocalGet(STATUS_STORAGE_KEY);
    const current = normalizeRemoteStatus(stored[STATUS_STORAGE_KEY]) ?? {};
    const next: RemoteSelectorsStatus = {
      ...current,
      ...update,
    };
    if (next.lastError) {
      next.lastError = normalizeStatusError(next.lastError);
    }
    await storageLocalSet({ [STATUS_STORAGE_KEY]: next });
  } catch (err) {
    debugError('Failed to persist remote selector status', err);
  }
}

async function getRemoteSelectorsUrl(): Promise<string | null> {
  const stored = await storageLocalGet(REMOTE_SELECTORS_URL_STORAGE_KEY);
  return validateRemoteSelectorsUrl(stored[REMOTE_SELECTORS_URL_STORAGE_KEY]);
}

export async function getRemoteSelectorsDiagnostics(): Promise<RemoteSelectorsDiagnostics> {
  try {
    const stored = await storageLocalGet([REMOTE_SELECTORS_URL_STORAGE_KEY, STATUS_STORAGE_KEY]);
    const url = validateRemoteSelectorsUrl(stored[REMOTE_SELECTORS_URL_STORAGE_KEY]);
    const status = normalizeRemoteStatus(stored[STATUS_STORAGE_KEY]);
    return {
      configured: Boolean(url),
      ...(url ? { url } : {}),
      ...(status ?? {}),
    };
  } catch (err) {
    debugError('Failed to load remote selector diagnostics', err);
    return { configured: false };
  }
}

export async function fetchRemoteSelectors(): Promise<SelectorConfig | null> {
  let configUrl: string | null = null;
  let attemptAt = 0;
  try {
    configUrl = await getRemoteSelectorsUrl();
    if (!configUrl) return null;
    attemptAt = Date.now();

    // 1. 尝试读取本地缓存
    const stored = await storageLocalGet(STORAGE_KEY);
    const cached = stored[STORAGE_KEY] as { timestamp: number; url?: string; data: SelectorConfig } | undefined;

    if (cached && cached.url === configUrl && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      debugLog('Using cached remote selectors', cached.data);
      return cached.data;
    }

    // 2. 缓存过期或不存在，发起网络请求
    // 注意：需要在 manifest.json 中添加 host_permissions 或确保 fetch 允许跨域
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(configUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => {
      globalThis.clearTimeout(timeout);
    });

    if (!response.ok) {
      throw new Error(`Remote config fetch failed: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > MAX_REMOTE_CONFIG_BYTES) {
        throw new Error('Remote config too large');
      }
    }

    const text = await response.text();
    if (text.length > MAX_REMOTE_CONFIG_BYTES) {
      throw new Error('Remote config too large');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new Error('Remote config JSON parse failed');
    }
    const data = parseSelectorConfig(raw);
    if (!data) {
      throw new Error('Remote config JSON schema mismatch');
    }

    // 3. 写入缓存
    await storageLocalSet({
      [STORAGE_KEY]: {
        timestamp: Date.now(),
        url: configUrl,
        data
      }
    });

    await updateRemoteSelectorsStatus({
      lastAttemptAt: attemptAt,
      lastFetchedAt: Date.now(),
      lastUrl: configUrl,
      lastVersion: data.version,
      lastStatus: 'ok',
      lastError: undefined,
    });

    debugLog('Updated remote selectors', data);
    return data;
  } catch (err) {
    if (configUrl) {
      await updateRemoteSelectorsStatus({
        lastAttemptAt: attemptAt || Date.now(),
        lastUrl: configUrl,
        lastStatus: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
    debugError('Failed to fetch remote selectors', err);
    return null;
  }
}

/**
 * 获取特定平台的选择器配置，自动合并远程与本地默认值
 * @param platform 平台名称
 * @param variant 变体 (如 legacy, testid)
 * @param defaultSelectors 硬编码的默认选择器
 */
export async function getMergedSelectors(
  platform: 'whatsapp' | 'telegram' | 'slack',
  variant: string,
  defaultSelectors: Record<string, string>
): Promise<Record<string, string>> {
  const remoteConfig = await fetchRemoteSelectors();
  
  const platformConfig = remoteConfig?.platforms?.[platform];
  if (!platformConfig) {
    return defaultSelectors;
  }

  let remoteVariant: Record<string, string> | null = null;
  if (platform === 'whatsapp') {
    const whatsapp = platformConfig as SelectorConfig['platforms']['whatsapp'] | undefined;
    if (variant === 'legacy') remoteVariant = whatsapp?.legacy ?? null;
    if (variant === 'testid') remoteVariant = whatsapp?.testid ?? null;
  } else {
    remoteVariant = platformConfig as Record<string, string>;
  }

  if (!remoteVariant) return defaultSelectors;

  // 远程覆盖本地
  return { ...defaultSelectors, ...remoteVariant };
}
