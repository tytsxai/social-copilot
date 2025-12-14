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

type DiagnosticEventType =
  | 'GENERATE_REPLY'
  | 'ANALYZE_THOUGHT'
  | 'SET_CONFIG'
  | 'FALLBACK'
  | 'RECOVERY'
  | 'ALL_FAILED'
  | 'MEMORY_UPDATE'
  | 'ADAPTER_HEALTH'
  | 'GET_STATUS'
  | 'GET_PROFILE'
  | 'UPDATE_PROFILE'
  | 'GET_CONTACT_MEMORY'
  | 'CLEAR_CONTACT_MEMORY'
  | 'RECORD_STYLE_SELECTION'
  | 'GET_STYLE_PREFERENCE'
  | 'RESET_STYLE_PREFERENCE'
  | 'EXPORT_PREFERENCES'
  | 'GET_CONTACTS'
  | 'CLEAR_DATA'
  | 'SET_DEBUG_ENABLED'
  | 'GET_DIAGNOSTICS'
  | 'CLEAR_DIAGNOSTICS'
  | 'UNKNOWN';

interface DiagnosticEvent {
  ts: number;
  type: DiagnosticEventType;
  requestId: string;
  durationMs?: number;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

// 配置类型
interface Config {
  apiKey: string;
  provider: ProviderType;
  /** 可选：指定模型名称（不填则使用 provider 默认） */
  model?: string;
  styles: ReplyStyle[];
  fallbackProvider?: ProviderType;
  /** 可选：指定备用模型名称（不填则使用 provider 默认） */
  fallbackModel?: string;
  fallbackApiKey?: string;
  enableFallback?: boolean;
  suggestionCount?: number;
  /** 是否启用长期记忆摘要（默认关闭） */
  enableMemory?: boolean;
  /** 是否持久化存储 API Key（默认不持久化以降低泄漏风险） */
  persistApiKey?: boolean;
}

// 初始化存储
const store = new IndexedDBStore();
let storeReady: Promise<void> | null = null;
let llmManager: LLMManager | null = null;
let profileUpdater: ProfileUpdater | null = null;
let preferenceManager: StylePreferenceManager | null = null;
let currentConfig: Config | null = null;
let fallbackModeActive = false;
const DEFAULT_STYLES: ReplyStyle[] = ['caring', 'humorous', 'casual'];

const lastProfileUpdateCount: Map<string, number> = new Map();
const lastMemoryUpdateCount: Map<string, number> = new Map();
const memoryUpdateInFlight: Set<string> = new Set();

const PROFILE_UPDATE_COUNT_STORAGE_KEY = 'profileUpdateCounts';
const MEMORY_UPDATE_COUNT_STORAGE_KEY = 'memoryUpdateCounts';
const DEBUG_ENABLED_STORAGE_KEY = 'debugEnabled';
const DIAGNOSTICS_MAX_EVENTS = 200;
const MEMORY_UPDATE_THRESHOLD = 50;
const MEMORY_CONTEXT_MESSAGE_LIMIT = 50;
const MEMORY_SUMMARY_MAX_LEN = 1024;

let debugEnabled = false;
let diagnostics: DiagnosticEvent[] = [];

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pushDiagnostic(event: DiagnosticEvent): void {
  diagnostics.push(event);
  if (diagnostics.length > DIAGNOSTICS_MAX_EVENTS) {
    diagnostics = diagnostics.slice(-DIAGNOSTICS_MAX_EVENTS);
  }
}

function sanitizeConfig(config: Config | null): Record<string, unknown> {
  if (!config) return { configured: false };
  return {
    configured: true,
    provider: config.provider,
    model: config.model,
    styles: config.styles,
    enableFallback: config.enableFallback ?? false,
    fallbackProvider: config.fallbackProvider,
    fallbackModel: config.fallbackModel,
    suggestionCount: normalizeSuggestionCount(config.suggestionCount),
    enableMemory: config.enableMemory ?? false,
    persistApiKey: config.persistApiKey ?? false,
    hasApiKey: Boolean(config.apiKey?.trim()),
    hasFallbackApiKey: Boolean(config.fallbackApiKey?.trim()),
  };
}

function normalizeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getProviderDefaultModel(provider: ProviderType): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5.2-chat-latest';
    case 'claude':
      return 'claude-sonnet-4-5';
    case 'deepseek':
    default:
      return 'deepseek-v3.2';
  }
}

function getSessionStorageArea(): chrome.storage.StorageArea | null {
  const storage = chrome.storage as unknown as { session?: chrome.storage.StorageArea };
  return storage.session ?? null;
}

async function setSessionKeys(apiKey: string, fallbackApiKey?: string): Promise<void> {
  const session = getSessionStorageArea();
  if (!session) return;
  const payload: Record<string, unknown> = { apiKey };
  if (fallbackApiKey) payload.fallbackApiKey = fallbackApiKey;
  await session.set(payload);
  if (!fallbackApiKey) {
    await session.remove(['fallbackApiKey']);
  }
}

async function getSessionKeys(): Promise<{ apiKey?: string; fallbackApiKey?: string }> {
  const session = getSessionStorageArea();
  if (!session) return {};
  const result = await session.get(['apiKey', 'fallbackApiKey']);
  return {
    apiKey: typeof result.apiKey === 'string' ? result.apiKey : undefined,
    fallbackApiKey: typeof result.fallbackApiKey === 'string' ? result.fallbackApiKey : undefined,
  };
}

async function clearSessionKeys(): Promise<void> {
  const session = getSessionStorageArea();
  if (!session) return;
  await session.remove(['apiKey', 'fallbackApiKey']);
}

function buildDiagnosticsSnapshot(): Record<string, unknown> {
  return {
    version: chrome.runtime.getManifest().version,
    debugEnabled,
    maxEvents: DIAGNOSTICS_MAX_EVENTS,
    eventCount: diagnostics.length,
    events: diagnostics,
  };
}

async function loadDebugEnabled(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(DEBUG_ENABLED_STORAGE_KEY);
    debugEnabled = Boolean(result[DEBUG_ENABLED_STORAGE_KEY]);
  } catch (err) {
    console.warn('[Social Copilot] Failed to load debug flag:', err);
  }
}

async function loadProfileUpdateCounts(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(PROFILE_UPDATE_COUNT_STORAGE_KEY);
    const stored = result[PROFILE_UPDATE_COUNT_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          lastProfileUpdateCount.set(key, value);
        }
      }
    }
  } catch (err) {
    console.warn('[Social Copilot] Failed to load profile update counts:', err);
  }
}

async function persistProfileUpdateCounts(): Promise<void> {
  const payload: Record<string, number> = {};
  for (const [key, value] of lastProfileUpdateCount.entries()) {
    payload[key] = value;
  }
  await chrome.storage.local.set({ [PROFILE_UPDATE_COUNT_STORAGE_KEY]: payload });
}

async function setLastProfileUpdateCount(contactKeyStr: string, count: number): Promise<void> {
  lastProfileUpdateCount.set(contactKeyStr, count);
  try {
    await persistProfileUpdateCounts();
  } catch (err) {
    console.warn('[Social Copilot] Failed to persist profile update counts:', err);
  }
}

async function loadMemoryUpdateCounts(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(MEMORY_UPDATE_COUNT_STORAGE_KEY);
    const stored = result[MEMORY_UPDATE_COUNT_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          lastMemoryUpdateCount.set(key, value);
        }
      }
    }
  } catch (err) {
    console.warn('[Social Copilot] Failed to load memory update counts:', err);
  }
}

async function persistMemoryUpdateCounts(): Promise<void> {
  const payload: Record<string, number> = {};
  for (const [key, value] of lastMemoryUpdateCount.entries()) {
    payload[key] = value;
  }
  await chrome.storage.local.set({ [MEMORY_UPDATE_COUNT_STORAGE_KEY]: payload });
}

async function setLastMemoryUpdateCount(contactKeyStr: string, count: number): Promise<void> {
  lastMemoryUpdateCount.set(contactKeyStr, count);
  try {
    await persistMemoryUpdateCounts();
  } catch (err) {
    console.warn('[Social Copilot] Failed to persist memory update counts:', err);
  }
}

function ensureStoreReady(): Promise<void> {
  if (!storeReady) {
    storeReady = (async () => {
      await store.init();
      preferenceManager = new StylePreferenceManager(store);
      await loadProfileUpdateCounts();
      await loadMemoryUpdateCounts();
      await loadDebugEnabled();
    })().catch((err) => {
      storeReady = null;
      throw err;
    });
  }
  return storeReady;
}

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Social Copilot] Extension installed');
  await ensureStoreReady();
  await loadConfig();
});

// 启动时初始化
ensureStoreReady().then(loadConfig).catch(console.error);

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
  await ensureStoreReady();

  const requestId = typeof request.requestId === 'string' && request.requestId.trim()
    ? request.requestId.trim()
    : generateRequestId();
  const startedAt = Date.now();
  const diagType = normalizeDiagnosticType(request.type);

  const record = (event: Omit<DiagnosticEvent, 'requestId'>) => {
    pushDiagnostic({ ...event, requestId });
    if (debugEnabled) {
      const label = event.ok ? 'ok' : 'err';
      console.log(`[Social Copilot][diag][${label}]`, event.type, requestId, event.details ?? event.error ?? {});
    }
  };

  try {
    const result = await dispatchMessage(requestId, request);
    if (diagType !== 'ADAPTER_HEALTH') {
      record({
        ts: Date.now(),
        type: diagType,
        ok: true,
        durationMs: Date.now() - startedAt,
        details: debugEnabled ? buildSuccessDetails(request, result) : buildMinimalSuccessDetails(request, result),
      });
    }
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (diagType !== 'ADAPTER_HEALTH') {
      record({
        ts: Date.now(),
        type: diagType,
        ok: false,
        durationMs: Date.now() - startedAt,
        details: debugEnabled ? buildErrorDetails(request) : buildMinimalErrorDetails(request),
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
    throw err;
  }
}

function normalizeDiagnosticType(type: string): DiagnosticEventType {
  switch (type) {
    case 'GENERATE_REPLY':
    case 'ANALYZE_THOUGHT':
    case 'SET_CONFIG':
    case 'GET_STATUS':
    case 'GET_PROFILE':
    case 'UPDATE_PROFILE':
    case 'GET_CONTACT_MEMORY':
    case 'CLEAR_CONTACT_MEMORY':
    case 'RECORD_STYLE_SELECTION':
    case 'GET_STYLE_PREFERENCE':
    case 'RESET_STYLE_PREFERENCE':
    case 'EXPORT_PREFERENCES':
    case 'GET_CONTACTS':
    case 'CLEAR_DATA':
    case 'SET_DEBUG_ENABLED':
    case 'GET_DIAGNOSTICS':
    case 'CLEAR_DIAGNOSTICS':
    case 'REPORT_ADAPTER_HEALTH':
      return type === 'REPORT_ADAPTER_HEALTH' ? 'ADAPTER_HEALTH' : type;
    case 'SET_PREFERRED_STYLE':
    case 'SET_API_KEY':
      // Normalize legacy aliases
      return 'SET_CONFIG';
    default:
      return 'UNKNOWN';
  }
}

function buildMinimalSuccessDetails(
  request: { type: string; [key: string]: unknown },
  result: unknown
): Record<string, unknown> {
  if (request.type === 'GENERATE_REPLY') {
    const r = result as { provider?: string; usingFallback?: boolean; latency?: number; candidates?: unknown[]; error?: string };
    return {
      provider: r.provider,
      usingFallback: r.usingFallback,
      latency: r.latency,
      candidateCount: Array.isArray(r.candidates) ? r.candidates.length : undefined,
      hasError: Boolean(r.error),
    };
  }
  if (request.type === 'SET_CONFIG') {
    return { config: sanitizeConfig(currentConfig) };
  }
  if (request.type === 'GET_STATUS') {
    const r = result as { hasApiKey?: boolean; activeProvider?: string; activeModel?: string; usingFallback?: boolean; hasFallback?: boolean };
    return {
      hasApiKey: r.hasApiKey,
      activeProvider: r.activeProvider,
      activeModel: r.activeModel,
      usingFallback: r.usingFallback,
      hasFallback: r.hasFallback,
    };
  }
  return {};
}

function buildSuccessDetails(
  request: { type: string; [key: string]: unknown },
  result: unknown
): Record<string, unknown> {
  if (request.type === 'GENERATE_REPLY') {
    const payload = request.payload as { contactKey: ContactKey; messages: Message[]; thoughtDirection?: ThoughtType } | undefined;
    const r = result as { provider?: string; usingFallback?: boolean; latency?: number; candidates?: Array<{ style?: string; text?: string }>; error?: string; model?: string };
    return {
      provider: r.provider,
      model: r.model,
      usingFallback: r.usingFallback,
      latency: r.latency,
      candidateCount: Array.isArray(r.candidates) ? r.candidates.length : undefined,
      candidateStyles: Array.isArray(r.candidates)
        ? r.candidates.map((c) => c.style)
        : undefined,
      candidateLengths: Array.isArray(r.candidates)
        ? r.candidates.map((c) => (typeof c.text === 'string' ? c.text.length : 0))
        : undefined,
      hasError: Boolean(r.error),
      thoughtDirection: payload?.thoughtDirection,
      contactKey: payload?.contactKey ? contactKeyToString(payload.contactKey) : undefined,
      messageCount: Array.isArray(payload?.messages) ? payload!.messages.length : undefined,
      lastMessageLen: Array.isArray(payload?.messages) && payload!.messages.length > 0
        ? payload!.messages[payload!.messages.length - 1].text.length
        : undefined,
    };
  }
  if (request.type === 'ANALYZE_THOUGHT') {
    const r = result as { result?: unknown; cards?: unknown[] };
    return { hasResult: Boolean(r.result), cardCount: Array.isArray(r.cards) ? r.cards.length : undefined };
  }
  if (request.type === 'SET_CONFIG') {
    return { config: sanitizeConfig(currentConfig) };
  }
  if (request.type === 'GET_DIAGNOSTICS') {
    const snapshot = result as Record<string, unknown>;
    return { eventCount: snapshot.eventCount, maxEvents: snapshot.maxEvents, debugEnabled: snapshot.debugEnabled };
  }
  return buildMinimalSuccessDetails(request, result);
}

function buildMinimalErrorDetails(request: { type: string; [key: string]: unknown }): Record<string, unknown> {
  if (request.type === 'GENERATE_REPLY') {
    return { provider: llmManager?.getActiveProvider(), config: sanitizeConfig(currentConfig) };
  }
  return {};
}

function buildErrorDetails(request: { type: string; [key: string]: unknown }): Record<string, unknown> {
  if (request.type === 'GENERATE_REPLY') {
    const payload = request.payload as { contactKey: ContactKey; messages: Message[]; thoughtDirection?: ThoughtType } | undefined;
    return {
      provider: llmManager?.getActiveProvider(),
      config: sanitizeConfig(currentConfig),
      contactKey: payload?.contactKey ? contactKeyToString(payload.contactKey) : undefined,
      messageCount: Array.isArray(payload?.messages) ? payload!.messages.length : undefined,
      messages: Array.isArray(payload?.messages)
        ? payload!.messages.map((m) => ({
            id: m.id,
            dir: m.direction,
            senderLen: (m.senderName ?? '').length,
            textLen: m.text.length,
            ts: m.timestamp,
          }))
        : undefined,
      thoughtDirection: payload?.thoughtDirection,
    };
  }
  if (request.type === 'SET_CONFIG') {
    return { nextConfig: sanitizeConfig(request.config as Config), prevConfig: sanitizeConfig(currentConfig) };
  }
  return buildMinimalErrorDetails(request);
}

async function dispatchMessage(
  requestId: string,
  request: { type: string; [key: string]: unknown }
) {
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

    case 'SET_DEBUG_ENABLED': {
      debugEnabled = Boolean(request.enabled);
      await chrome.storage.local.set({ [DEBUG_ENABLED_STORAGE_KEY]: debugEnabled });
      return { success: true, debugEnabled };
    }

    case 'GET_DIAGNOSTICS':
      return buildDiagnosticsSnapshot();

    case 'CLEAR_DIAGNOSTICS':
      diagnostics = [];
      return { success: true };

    case 'GET_STATUS': {
      const hasApiKey = !!llmManager;
      const hasFallback = llmManager?.hasFallback() ?? false;
      const usingFallback = Boolean(fallbackModeActive && hasFallback);

      const activeModel = currentConfig
        ? usingFallback
          ? currentConfig.fallbackModel || getProviderDefaultModel(currentConfig.fallbackProvider || currentConfig.provider)
          : currentConfig.model || getProviderDefaultModel(currentConfig.provider)
        : undefined;

      return {
        hasApiKey,
        activeProvider: llmManager?.getActiveProvider(),
        activeModel,
        usingFallback,
        hasFallback,
        debugEnabled,
        requestId,
      };
    }

    case 'GET_PROFILE':
      return getProfile(request.contactKey as ContactKey);

    case 'UPDATE_PROFILE':
      return updateProfile(request.contactKey as ContactKey, request.updates as Partial<ContactProfile>);

    case 'GET_CONTACT_MEMORY':
      return getContactMemory(request.contactKey as ContactKey);

    case 'CLEAR_CONTACT_MEMORY':
      return clearContactMemory(request.contactKey as ContactKey);

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

    case 'REPORT_ADAPTER_HEALTH': {
      const payload = request.payload as Record<string, unknown> | undefined;
      const ok = Boolean(payload?.ok);
      pushDiagnostic({
        ts: Date.now(),
        type: 'ADAPTER_HEALTH',
        requestId,
        ok,
        details: {
          app: payload?.app,
          host: payload?.host,
          pathname: payload?.pathname,
          adapterVariant: payload?.adapterVariant,
          adapterSelectorHints: payload?.adapterSelectorHints,
          hasInput: payload?.hasInput,
          hasContactKey: payload?.hasContactKey,
          messageCount: payload?.messageCount,
          reason: payload?.reason,
          inputTag: payload?.inputTag,
          inputContentEditable: payload?.inputContentEditable,
          inputRole: payload?.inputRole,
          contactKeySummary: payload?.contactKeySummary,
          lastMessageSummary: payload?.lastMessageSummary,
        },
      });
      return { success: true };
    }

    default:
      return { error: 'Unknown message type', requestId };
  }
}

async function loadConfig() {
  const result = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'styles',
    'fallbackProvider',
    'fallbackModel',
    'fallbackApiKey',
    'enableFallback',
    'suggestionCount',
    'persistApiKey',
    'enableMemory',
  ]);

  const persistApiKey = result.persistApiKey ?? false;
  const enableFallback = result.enableFallback ?? false;
  const enableMemory = result.enableMemory ?? false;

  const keys = persistApiKey
    ? {
        apiKey: result.apiKey as string | undefined,
        fallbackApiKey: result.fallbackApiKey as string | undefined,
      }
    : await getSessionKeys();

  if (keys.apiKey) {
    await setConfig({
      apiKey: keys.apiKey,
      provider: result.provider || 'deepseek',
      model: normalizeModel(result.model),
      styles: (result.styles as ReplyStyle[] | undefined) || DEFAULT_STYLES,
      fallbackProvider: result.fallbackProvider,
      fallbackModel: normalizeModel(result.fallbackModel),
      fallbackApiKey: keys.fallbackApiKey,
      enableFallback,
      suggestionCount: normalizeSuggestionCount(result.suggestionCount),
      enableMemory,
      persistApiKey,
    });
  }
}

async function setConfig(config: Config) {
  const incomingApiKey = (config.apiKey ?? '').trim();
  const apiKey = incomingApiKey || currentConfig?.apiKey || '';
  if (!apiKey) {
    return { error: 'API Key is required' };
  }

  const normalizedStyles = sanitizeStyles(config.styles);
  const normalizedSuggestionCount = normalizeSuggestionCount(config.suggestionCount);

  const enableFallback = config.enableFallback ?? false;
  const incomingFallbackApiKey = (config.fallbackApiKey ?? '').trim();
  const fallbackApiKey = enableFallback
    ? (incomingFallbackApiKey || currentConfig?.fallbackApiKey || '')
    : undefined;
  if (enableFallback && !fallbackApiKey) {
    return { error: 'Fallback API Key is required' };
  }

  currentConfig = {
    ...config,
    apiKey,
    model: normalizeModel(config.model),
    enableFallback,
    fallbackModel: normalizeModel(config.fallbackModel),
    fallbackApiKey,
    styles: normalizedStyles,
    suggestionCount: normalizedSuggestionCount,
    enableMemory: config.enableMemory ?? false,
    persistApiKey: config.persistApiKey ?? false,
  };

  // 保存到 storage
  const baseConfigToPersist = {
    provider: currentConfig.provider,
    model: currentConfig.model,
    styles: currentConfig.styles,
    fallbackProvider: currentConfig.fallbackProvider,
    fallbackModel: currentConfig.fallbackModel,
    enableFallback: currentConfig.enableFallback ?? false,
    suggestionCount: currentConfig.suggestionCount,
    enableMemory: currentConfig.enableMemory ?? false,
    persistApiKey: currentConfig.persistApiKey ?? false,
  };

  if (currentConfig.persistApiKey) {
    const toSet: Record<string, unknown> = {
      ...baseConfigToPersist,
      apiKey: currentConfig.apiKey,
    };
    if (currentConfig.enableFallback && currentConfig.fallbackApiKey) {
      toSet.fallbackApiKey = currentConfig.fallbackApiKey;
    }
    await chrome.storage.local.set(toSet);
    if (!(currentConfig.enableFallback && currentConfig.fallbackApiKey)) {
      await chrome.storage.local.remove(['fallbackApiKey']);
    }
    await clearSessionKeys();
  } else {
    await chrome.storage.local.set(baseConfigToPersist);
    await chrome.storage.local.remove(['apiKey', 'fallbackApiKey']);
    try {
      await setSessionKeys(currentConfig.apiKey, currentConfig.enableFallback ? currentConfig.fallbackApiKey : undefined);
    } catch (err) {
      console.warn('[Social Copilot] Failed to persist session keys (service worker may lose key on restart):', err);
    }
  }

  const managerConfig = buildManagerConfig(currentConfig);
  fallbackModeActive = false;
  llmManager = new LLMManager(managerConfig, {
    onFallback: handleFallbackEvent,
    onRecovery: handleRecoveryEvent,
    onAllFailed: handleAllFailedEvent,
  });

  const profileLLM: LLMProvider = {
    get name() {
      return llmManager?.getActiveProvider() || currentConfig?.provider || 'deepseek';
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
  console.log(`[Social Copilot] Config updated: provider=${currentConfig.provider}, fallback=${fallbackLabel}`);
  return { success: true };
}

function buildManagerConfig(config: Config): LLMManagerConfig {
  const fallbackEnabled = (config.enableFallback ?? false) && !!config.fallbackApiKey;
  return {
    primary: { provider: config.provider, apiKey: config.apiKey, model: config.model },
    fallback: fallbackEnabled
      ? {
          provider: config.fallbackProvider || config.provider,
          apiKey: config.fallbackApiKey as string,
          model: config.fallbackModel,
        }
      : undefined,
  };
}

async function handleFallbackEvent(fromProvider: string, toProvider: string, error: Error) {
  console.warn('[Social Copilot] Fallback triggered:', error);
  fallbackModeActive = true;
  pushDiagnostic({
    ts: Date.now(),
    type: 'FALLBACK',
    requestId: generateRequestId(),
    ok: true,
    details: { fromProvider, toProvider, message: error.message },
  });
}

async function handleRecoveryEvent(provider: string) {
  fallbackModeActive = false;
  pushDiagnostic({
    ts: Date.now(),
    type: 'RECOVERY',
    requestId: generateRequestId(),
    ok: true,
    details: { provider },
  });
}

async function handleAllFailedEvent(errors: Error[]) {
  pushDiagnostic({
    ts: Date.now(),
    type: 'ALL_FAILED',
    requestId: generateRequestId(),
    ok: false,
    error: { name: 'AllProvidersFailed', message: errors.map((e) => e.message).join('; ') },
  });
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
  let memorySummary: string | undefined;

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
  } else {
    profile = await maybeMigrateContactState(contactKey, profile);
  }

  // 检查是否需要更新画像
  profile = await maybeUpdateProfile(contactKey, profile, messages, messageCount);

  // 读取长期记忆（用于增强本次回复）
  if (currentConfig?.enableMemory ?? false) {
    try {
      const memory = await store.getContactMemorySummary(contactKey);
      if (memory?.summary) {
        memorySummary = memory.summary;
      }
    } catch (err) {
      // best-effort
    }
  }

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

  // 注入长期记忆
  if (memorySummary) {
    input.memorySummary = memorySummary;
  }

  // 添加思路方向
  if (thoughtDirection) {
    input.thoughtDirection = thoughtDirection;
    input.thoughtHint = THOUGHT_CARDS[thoughtDirection]?.promptHint;
  }

  // 调用 LLM
  try {
    const output = await llmManager.generateReply(input);
    const activeProvider = llmManager.getActiveProvider();

    // 异步更新长期记忆（不阻塞本次回复）
    if (currentConfig?.enableMemory ?? false) {
      void maybeUpdateMemory(contactKey, profile, messageCount);
    }

    return {
      candidates: output.candidates,
      model: output.model,
      latency: output.latency,
      provider: activeProvider,
      usingFallback: Boolean(fallbackModeActive && llmManager.hasFallback()),
    };
  } catch (error) {
    console.error('[Social Copilot] Failed to generate reply:', error);
    const message = toUserErrorMessage(error);

    if (currentConfig?.enableMemory ?? false) {
      void maybeUpdateMemory(contactKey, profile, messageCount);
    }
    return { error: message };
  }
}

async function maybeMigrateContactState(contactKey: ContactKey, profile: ContactProfile): Promise<ContactProfile> {
  const desiredKeyStr = contactKeyToString(contactKey);
  const currentKeyStr = contactKeyToString(profile.key);
  if (desiredKeyStr === currentKeyStr) return profile;

  // Migrate profile key to the new canonical ContactKey (stable conversationId/accountId).
  const migrated: ContactProfile = {
    ...profile,
    key: contactKey,
    displayName: contactKey.peerId || profile.displayName,
    updatedAt: Date.now(),
  };

  try {
    await store.saveProfile(migrated);
  } catch (err) {
    console.warn('[Social Copilot] Failed to migrate profile key:', err);
  }

  // Best-effort: copy style preferences & memory summary to new key (do not delete old records).
  try {
    const pref = await store.getStylePreference(profile.key);
    if (pref && pref.contactKeyStr !== desiredKeyStr) {
      await store.saveStylePreference({ ...pref, contactKeyStr: desiredKeyStr, updatedAt: Date.now() });
    }
  } catch {
    // ignore
  }

  try {
    const memory = await store.getContactMemorySummary(profile.key);
    if (memory && memory.summary) {
      await store.saveContactMemorySummary(contactKey, memory.summary);
    }
  } catch {
    // ignore
  }

  return migrated;
}

function toUserErrorMessage(error: unknown): string {
  if (error instanceof ReplyParseError) {
    return 'AI 回复格式不正确，请重试。';
  }
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out/i.test(message) || /timeout/i.test(message)) {
    return '请求超时，请检查网络后重试。';
  }
  if (message.includes('401')) {
    return 'API Key 无效或权限不足（401）。';
  }
  if (message.includes('403')) {
    return '访问被拒绝（403）。';
  }
  if (message.includes('429')) {
    return '请求过于频繁或配额不足（429），请稍后重试。';
  }
  if (/(500|502|503|504)/.test(message)) {
    return '模型服务异常，请稍后重试。';
  }

  return message || '请求失败，请重试。';
}

function normalizeSuggestionCount(count: unknown): 2 | 3 {
  return count === 2 ? 2 : 3;
}

function sanitizeStyles(styles: unknown): ReplyStyle[] {
  const allowed: ReplyStyle[] = ['humorous', 'caring', 'rational', 'casual', 'formal'];
  if (!Array.isArray(styles)) {
    return DEFAULT_STYLES;
  }
  const unique = Array.from(new Set(styles.filter((s): s is ReplyStyle => allowed.includes(s as ReplyStyle))));
  return unique.length > 0 ? unique : DEFAULT_STYLES;
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
    if (debugEnabled) {
      console.log('[Social Copilot] Updating profile for:', profile.displayName);
    }

    try {
      const updates = await profileUpdater.extractProfileUpdates(recentMessages, profile);
      if (Object.keys(updates).length > 0) {
        await store.updateProfile(contactKey, updates);
        const refreshed = await store.getProfile(contactKey);
        if (refreshed) {
          profile = refreshed;
        }
        if (debugEnabled) {
          console.log('[Social Copilot] Profile updated');
        }
      }
    } catch (error) {
      console.error('[Social Copilot] Failed to update profile:', error);
    } finally {
      await setLastProfileUpdateCount(contactKeyStr, messageCount);
    }
  }

  return profile;
}

async function maybeUpdateMemory(contactKey: ContactKey, profile: ContactProfile, messageCount: number): Promise<void> {
  if (!llmManager) return;
  if (!(currentConfig?.enableMemory ?? false)) return;
  // 默认不对群聊做长期记忆，避免噪声与隐私风险
  if (contactKey.isGroup) return;

  const contactKeyStr = contactKeyToString(contactKey);
  const lastUpdate = lastMemoryUpdateCount.get(contactKeyStr) || 0;
  if (messageCount - lastUpdate < MEMORY_UPDATE_THRESHOLD) return;
  if (memoryUpdateInFlight.has(contactKeyStr)) return;

  memoryUpdateInFlight.add(contactKeyStr);
  const startedAt = Date.now();

  try {
    const recentMessages = await store.getRecentMessages(contactKey, MEMORY_CONTEXT_MESSAGE_LIMIT);
    if (recentMessages.length === 0) {
      return;
    }

    const existing = await store.getContactMemorySummary(contactKey);
    const input: LLMInput = {
      task: 'memory_extraction',
      context: {
        contactKey,
        recentMessages,
        currentMessage: recentMessages[recentMessages.length - 1],
      },
      profile,
      memorySummary: existing?.summary,
      styles: ['rational'],
      language: 'zh',
      maxLength: 800,
    };

    const output = await llmManager.generateReply(input);
    const raw = output.candidates[0]?.text ?? '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error('Memory extraction did not return valid JSON');
    }

    const summary = (parsed as { summary?: unknown })?.summary;
    if (typeof summary !== 'string' || summary.trim() === '') {
      throw new Error('Memory extraction returned empty summary');
    }

    const normalized = summary.trim().slice(0, MEMORY_SUMMARY_MAX_LEN);
    await store.saveContactMemorySummary(contactKey, normalized);
    await setLastMemoryUpdateCount(contactKeyStr, messageCount);

    pushDiagnostic({
      ts: Date.now(),
      type: 'MEMORY_UPDATE',
      requestId: generateRequestId(),
      ok: true,
      durationMs: Date.now() - startedAt,
      details: {
        contactKey: contactKeyStr,
        provider: llmManager.getActiveProvider(),
        model: output.model,
        latency: output.latency,
        summaryLen: normalized.length,
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    pushDiagnostic({
      ts: Date.now(),
      type: 'MEMORY_UPDATE',
      requestId: generateRequestId(),
      ok: false,
      durationMs: Date.now() - startedAt,
      details: { contactKey: contactKeyStr },
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  } finally {
    memoryUpdateInFlight.delete(contactKeyStr);
  }
}

async function getProfile(contactKey: ContactKey) {
  const profile = await store.getProfile(contactKey);
  return { profile };
}

async function updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>) {
  await store.updateProfile(contactKey, updates);
  return { success: true };
}

async function getContactMemory(contactKey: ContactKey) {
  const memory = await store.getContactMemorySummary(contactKey);
  return { memory };
}

async function clearContactMemory(contactKey: ContactKey) {
  await store.deleteContactMemorySummary(contactKey);
  const keyStr = contactKeyToString(contactKey);
  lastMemoryUpdateCount.delete(keyStr);
  try {
    await persistMemoryUpdateCounts();
  } catch (err) {
    console.warn('[Social Copilot] Failed to persist memory update counts:', err);
  }
  return { success: true };
}

async function getContacts() {
  try {
    const profiles = await store.getAllProfiles();
    const contacts = await Promise.all(
      profiles.map(async (profile) => {
        const messageCount = await store.getMessageCount(profile.key);
        const memory = await store.getContactMemorySummary(profile.key);
        return {
          displayName: profile.displayName,
          app: profile.key.app,
          messageCount,
          key: profile.key,
          memorySummary: memory?.summary ?? null,
          memoryUpdatedAt: memory?.updatedAt ?? null,
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
  await clearSessionKeys();
  lastProfileUpdateCount.clear();
  lastMemoryUpdateCount.clear();
  memoryUpdateInFlight.clear();
  diagnostics = [];
  debugEnabled = false;
  try {
    await chrome.storage.local.remove(PROFILE_UPDATE_COUNT_STORAGE_KEY);
  } catch (err) {
    console.warn('[Social Copilot] Failed to clear profile update counts:', err);
  }
  try {
    await chrome.storage.local.remove(MEMORY_UPDATE_COUNT_STORAGE_KEY);
  } catch (err) {
    console.warn('[Social Copilot] Failed to clear memory update counts:', err);
  }
  llmManager = null;
  fallbackModeActive = false;
  profileUpdater = null;
  preferenceManager = null;
  currentConfig = null;
  storeReady = null;

  // 重新初始化存储
  await store.deleteDatabase();
  await ensureStoreReady();

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
