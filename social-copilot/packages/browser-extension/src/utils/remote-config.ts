import { debugError, debugLog } from './debug';

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

// 重要：请将此处的 your-username 替换为你存放 selectors.json 的真实 GitHub 用户名
const USERNAME = 'your-username'; 
const CONFIG_URL = `https://raw.githubusercontent.com/${USERNAME}/social-copilot-config/main/selectors.json`; 
const STORAGE_KEY = 'remote_selector_config';
const CACHE_DURATION_MS = 1000 * 60 * 60 * 24; // 24小时缓存

export async function fetchRemoteSelectors(): Promise<SelectorConfig | null> {
  try {
    // 1. 尝试读取本地缓存
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const cached = stored[STORAGE_KEY] as { timestamp: number; data: SelectorConfig } | undefined;

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      debugLog('Using cached remote selectors', cached.data);
      return cached.data;
    }

    // 2. 缓存过期或不存在，发起网络请求
    // 注意：需要在 manifest.json 中添加 host_permissions 或确保 fetch 允许跨域
    const response = await fetch(CONFIG_URL, {
        method: 'GET',
        cache: 'no-cache'
    });

    if (!response.ok) {
      throw new Error(`Remote config fetch failed: ${response.statusText}`);
    }

    const data = await response.json() as SelectorConfig;

    // 3. 写入缓存
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        timestamp: Date.now(),
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
  
  if (!remoteConfig?.platforms?.[platform]) {
    return defaultSelectors;
  }

  // @ts-expect-error - variant access needs structural safety but keeping it simple for now
  const remoteVariant = remoteConfig.platforms[platform][variant];
  
  if (!remoteVariant) {
    return defaultSelectors;
  }

  // 远程覆盖本地
  return { ...defaultSelectors, ...remoteVariant };
}
