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

const REMOTE_SELECTORS_URL_STORAGE_KEY = 'remoteSelectorsUrl';
const STORAGE_KEY = 'remote_selector_config';
const CACHE_DURATION_MS = 1000 * 60 * 60 * 24; // 24小时缓存
const FETCH_TIMEOUT_MS = 7000;

const MAX_REMOTE_CONFIG_BYTES = 100_000;
const MAX_SELECTOR_ENTRIES = 120;
const MAX_SELECTOR_KEY_LENGTH = 64;
const MAX_SELECTOR_VALUE_LENGTH = 400;

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

function validateRemoteSelectorsUrl(raw: unknown): string | null {
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
  if (!url.pathname.endsWith('.json')) return null;
  return url.toString();
}

async function getRemoteSelectorsUrl(): Promise<string | null> {
  const stored = await storageLocalGet(REMOTE_SELECTORS_URL_STORAGE_KEY);
  return validateRemoteSelectorsUrl(stored[REMOTE_SELECTORS_URL_STORAGE_KEY]);
}

export async function fetchRemoteSelectors(): Promise<SelectorConfig | null> {
  try {
    const configUrl = await getRemoteSelectorsUrl();
    if (!configUrl) return null;

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

    debugLog('Updated remote selectors', data);
    return data;
  } catch (err) {
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
