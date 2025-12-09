import { IndexedDBStore, ProfileUpdater, LLMManager, StylePreferenceManager, ThoughtAnalyzer, ReplyParseError } from '@social-copilot/core';
import type {
  Message,
  ContactKey,
  LLMInput,
  ReplyStyle,
  ContactProfile,
  LLMProvider,
  ThoughtType,
  ConversationContext,
} from '@social-copilot/core';
import { contactKeyToString, THOUGHT_CARDS } from '@social-copilot/core';
import type { ProviderType, LLMManagerConfig } from '@social-copilot/core';

// 配置类型
interface Config {
  apiKey: string;
  provider: ProviderType;
  styles: ReplyStyle[];
  fallbackProvider?: ProviderType;
  fallbackApiKey?: string;
  enableFallback?: boolean;
  suggestionCount?: number;
}

// 初始化存储
const store = new IndexedDBStore();
let llmManager: LLMManager | null = null;
let profileUpdater: ProfileUpdater | null = null;
let preferenceManager: StylePreferenceManager | null = null;
let currentConfig: Config | null = null;
const DEFAULT_STYLES: ReplyStyle[] = ['caring', 'humorous', 'casual'];

const lastProfileUpdateCount: Map<string, number> = new Map();

async function initStore() {
  await store.init();
  preferenceManager = new StylePreferenceManager(store);
}

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Social Copilot] Extension installed');
  await initStore();
  await loadConfig();
});

// 启动时初始化
initStore().then(loadConfig).catch(console.error);

// 监听消息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  handleMessage(request)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Social Copilot] Error:', error);
      sendResponse({ error: error.message });
    });
  return true;
});

async function handleMessage(request: { type: string; [key: string]: unknown }) {
  switch (request.type) {
    case 'GENERATE_REPLY':
      return handleGenerateReply(
        request.payload as {
          contactKey: ContactKey;
          messages: Message[];
          currentMessage: Message;
          thoughtDirection?: ThoughtType;
        }
      );

    case 'ANALYZE_THOUGHT':
      return handleAnalyzeThought(
        request.payload as {
          context: ConversationContext;
        }
      );

    case 'SET_API_KEY':
      // 兼容旧版本
      return setConfig({
        apiKey: request.apiKey as string,
        provider: 'deepseek',
        styles: DEFAULT_STYLES,
      });

    case 'SET_CONFIG':
      return setConfig(request.config as Config);

    case 'GET_STATUS':
      return {
        hasApiKey: !!llmManager,
        activeProvider: llmManager?.getActiveProvider(),
        hasFallback: llmManager?.hasFallback() ?? false,
      };

    case 'GET_PROFILE':
      return getProfile(request.contactKey as ContactKey);

    case 'UPDATE_PROFILE':
      return updateProfile(request.contactKey as ContactKey, request.updates as Partial<ContactProfile>);

    case 'SET_PREFERRED_STYLE':
      return recordStyleSelection(request.contactKey as ContactKey, request.style as ReplyStyle);

    case 'RECORD_STYLE_SELECTION':
      return recordStyleSelection(request.contactKey as ContactKey, request.style as ReplyStyle);

    case 'GET_STYLE_PREFERENCE':
      return getStylePreference(request.contactKey as ContactKey);

    case 'RESET_STYLE_PREFERENCE':
      return resetStylePreference(request.contactKey as ContactKey);

    case 'EXPORT_PREFERENCES':
      return exportPreferences();

    case 'GET_CONTACTS':
      return getContacts();

    case 'CLEAR_DATA':
      return clearData();

    default:
      return { error: 'Unknown message type' };
  }
}

async function loadConfig() {
  const result = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'styles',
    'fallbackProvider',
    'fallbackApiKey',
    'enableFallback',
    'suggestionCount',
  ]);

  if (result.apiKey) {
    await setConfig({
      apiKey: result.apiKey,
      provider: result.provider || 'deepseek',
      styles: (result.styles as ReplyStyle[] | undefined) || DEFAULT_STYLES,
      fallbackProvider: result.fallbackProvider,
      fallbackApiKey: result.fallbackApiKey,
      enableFallback: result.enableFallback ?? false,
      suggestionCount: normalizeSuggestionCount(result.suggestionCount),
    });
  }
}

async function setConfig(config: Config) {
  currentConfig = config;

  // 保存到 storage
  await chrome.storage.local.set({
    apiKey: config.apiKey,
    provider: config.provider,
    styles: config.styles,
    fallbackProvider: config.fallbackProvider,
    fallbackApiKey: config.fallbackApiKey,
    enableFallback: config.enableFallback ?? false,
    suggestionCount: normalizeSuggestionCount(config.suggestionCount),
  });

  const managerConfig = buildManagerConfig(config);
  llmManager = new LLMManager(managerConfig, {
    onFallback: handleFallbackEvent,
    onRecovery: handleRecoveryEvent,
    onAllFailed: handleAllFailedEvent,
  });

  const profileLLM: LLMProvider = {
    get name() {
      return llmManager?.getActiveProvider() || config.provider;
    },
    generateReply: (input: LLMInput) => {
      if (!llmManager) {
        throw new Error('LLM manager not initialized');
      }
      return llmManager.generateReply(input);
    },
  };

  profileUpdater = new ProfileUpdater(profileLLM, 20);

  const fallbackLabel = managerConfig.fallback ? managerConfig.fallback.provider : 'disabled';
  console.log(`[Social Copilot] Config updated: provider=${config.provider}, fallback=${fallbackLabel}`);
  return { success: true };
}

function buildManagerConfig(config: Config): LLMManagerConfig {
  const fallbackEnabled = (config.enableFallback ?? false) && !!config.fallbackApiKey;
  return {
    primary: { provider: config.provider, apiKey: config.apiKey },
    fallback: fallbackEnabled
      ? {
          provider: config.fallbackProvider || config.provider,
          apiKey: config.fallbackApiKey as string,
        }
      : undefined,
  };
}

async function handleFallbackEvent(fromProvider: string, toProvider: string, error: Error) {
  console.warn('[Social Copilot] Fallback triggered:', error);
  await notifyTabs({
    type: 'FALLBACK_NOTIFICATION',
    fromProvider,
    toProvider,
    message: error.message,
  });
}

async function handleRecoveryEvent(provider: string) {
  await notifyTabs({
    type: 'FALLBACK_RECOVERY',
    provider,
  });
}

async function handleAllFailedEvent(errors: Error[]) {
  await notifyTabs({
    type: 'LLM_ALL_FAILED',
    errors: errors.map((e) => e.message),
  });
}

async function notifyTabs(message: unknown) {
  const tabs = await chrome.tabs.query({
    url: [
      'https://web.telegram.org/*',
      'https://web.whatsapp.com/*',
      'https://app.slack.com/*',
    ],
  });

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      // Ignore tabs without listeners
    }
  }
}

async function handleAnalyzeThought(payload: { context: ConversationContext }) {
  const analyzer = new ThoughtAnalyzer();
  const result = analyzer.analyze(payload.context);
  const cards = analyzer.getRecommendedCards(result);
  return { result, cards };
}

async function handleGenerateReply(payload: {
  contactKey: ContactKey;
  messages: Message[];
  currentMessage: Message;
  thoughtDirection?: ThoughtType;
}) {
  const { contactKey, messages, currentMessage, thoughtDirection } = payload;

  // 保存消息
  for (const msg of messages) {
    await store.saveMessage(msg);
  }

  const messageCount = await store.getMessageCount(contactKey);

  // 获取或创建画像
  let profile = await store.getProfile(contactKey);
  if (!profile) {
    profile = {
      key: contactKey,
      displayName: contactKey.peerId,
      interests: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.saveProfile(profile);
  }

  // 检查是否需要更新画像
  profile = await maybeUpdateProfile(contactKey, profile, messages, messageCount);

  // 检查 LLM
  if (!llmManager) {
    await loadConfig();
    if (!llmManager) {
      return { error: '请先设置 API Key' };
    }
  }

  // 获取配置的风格（按偏好排序）
  const suggestionCount = normalizeSuggestionCount(currentConfig?.suggestionCount);
  const baseStyles = (currentConfig?.styles || DEFAULT_STYLES).slice(0, suggestionCount);
  const recommended = preferenceManager
    ? await preferenceManager.getRecommendedStyles(contactKey)
    : baseStyles;
  const styles = mergeStyles(baseStyles, recommended).slice(0, suggestionCount);

  // 构建输入
  const input: LLMInput = {
    context: {
      contactKey,
      recentMessages: messages,
      currentMessage,
    },
    profile,
    styles: styles as ReplyStyle[],
    language: 'zh',
  };

  // 添加思路方向
  if (thoughtDirection) {
    input.thoughtDirection = thoughtDirection;
    input.thoughtHint = THOUGHT_CARDS[thoughtDirection]?.promptHint;
  }

  // 调用 LLM
  try {
    const output = await llmManager.generateReply(input);
    const activeProvider = llmManager.getActiveProvider();

    return {
      candidates: output.candidates,
      model: output.model,
      latency: output.latency,
      provider: activeProvider,
      usingFallback: currentConfig ? activeProvider !== currentConfig.provider : false,
    };
  } catch (error) {
    console.error('[Social Copilot] Failed to generate reply:', error);
    const message = error instanceof ReplyParseError
      ? 'AI 回复格式不正确，请重试。'
      : (error as Error).message;
    return { error: message };
  }
}

function normalizeSuggestionCount(count: unknown): 2 | 3 {
  return count === 2 ? 2 : 3;
}

async function maybeUpdateProfile(
  contactKey: ContactKey,
  profile: ContactProfile,
  recentMessages: Message[],
  messageCount: number
): Promise<ContactProfile> {
  if (!profileUpdater) return profile;

  const contactKeyStr = contactKeyToString(contactKey);
  const lastUpdate = lastProfileUpdateCount.get(contactKeyStr) || 0;

  if (profileUpdater.shouldUpdate(messageCount, lastUpdate)) {
    console.log('[Social Copilot] Updating profile for:', profile.displayName);

    try {
      const updates = await profileUpdater.extractProfileUpdates(recentMessages, profile);
      if (Object.keys(updates).length > 0) {
        await store.updateProfile(contactKey, updates);
        const refreshed = await store.getProfile(contactKey);
        if (refreshed) {
          profile = refreshed;
        }
        console.log('[Social Copilot] Profile updated:', updates);
      }
      lastProfileUpdateCount.set(contactKeyStr, messageCount);
    } catch (error) {
      console.error('[Social Copilot] Failed to update profile:', error);
    }
  }

  return profile;
}

async function getProfile(contactKey: ContactKey) {
  const profile = await store.getProfile(contactKey);
  return { profile };
}

async function updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>) {
  await store.updateProfile(contactKey, updates);
  return { success: true };
}

async function getContacts() {
  try {
    const profiles = await store.getAllProfiles();
    const contacts = await Promise.all(
      profiles.map(async (profile) => {
        const messageCount = await store.getMessageCount(profile.key);
        return {
          displayName: profile.displayName,
          app: profile.key.app,
          messageCount,
          key: profile.key,
        };
      })
    );
    return { contacts };
  } catch (error) {
    console.error('[Social Copilot] Failed to get contacts:', error);
    return { contacts: [] };
  }
}

async function clearData() {
  await chrome.storage.local.clear();
  lastProfileUpdateCount.clear();
  llmManager = null;
  profileUpdater = null;
  preferenceManager = null;
  currentConfig = null;

  // 重新初始化存储
  await store.deleteDatabase();
  await initStore();

  return { success: true };
}

function isReplyStyle(style: unknown): style is ReplyStyle {
  return ['humorous', 'caring', 'rational', 'casual', 'formal'].includes(style as string);
}

function mergeStyles(base: ReplyStyle[], recommended: ReplyStyle[]): ReplyStyle[] {
  const ordered: ReplyStyle[] = [];
  for (const style of recommended) {
    if (base.includes(style) && !ordered.includes(style)) {
      ordered.push(style);
    }
  }
  for (const style of base) {
    if (!ordered.includes(style)) {
      ordered.push(style);
    }
  }
  return ordered.slice(0, base.length);
}

async function recordStyleSelection(contactKey: ContactKey, style: ReplyStyle) {
  if (!isReplyStyle(style)) return { success: false };
  if (!preferenceManager) {
    preferenceManager = new StylePreferenceManager(store);
  }
  await preferenceManager.recordStyleSelection(contactKey, style);
  return { success: true };
}

async function getStylePreference(contactKey: ContactKey) {
  if (!preferenceManager) {
    preferenceManager = new StylePreferenceManager(store);
  }
  const preference = await preferenceManager.getPreference(contactKey);
  return { preference };
}

async function resetStylePreference(contactKey: ContactKey) {
  if (!preferenceManager) {
    preferenceManager = new StylePreferenceManager(store);
  }
  await preferenceManager.resetPreference(contactKey);
  return { success: true };
}

async function exportPreferences() {
  if (!preferenceManager) {
    preferenceManager = new StylePreferenceManager(store);
  }
  const preferences = await preferenceManager.exportPreferences();
  return { preferences };
}
