import {
  IndexedDBStore,
  ProfileUpdater,
  LLMManager,
  PromptHookRegistry,
  StylePreferenceManager,
  ThoughtAnalyzer,
  ReplyParseError,
  parseJsonObjectFromText,
  redactPii,
  sanitizeOutboundContext,
  redactSecrets,
  BUILTIN_MODEL,
} from '@social-copilot/core';
import {
  addRuntimeOnInstalledListener,
  addRuntimeOnMessageListener,
  addRuntimeOnStartupListener,
  runtimeGetId,
  runtimeGetManifestVersion,
  runtimeOpenOptionsPage,
  storageLocalClear,
  storageLocalGet,
  storageLocalRemove,
  storageLocalSet,
  storageSessionGet,
  storageSessionRemove,
  storageSessionSet,
} from '../utils/webext';
import type {
  Message,
  ContactKey,
  LLMInput,
  ReplyStyle,
  ContactProfile,
  StylePreference,
  ContactMemorySummary,
  LLMProvider,
  ThoughtType,
  ConversationContext,
} from '@social-copilot/core';
import {
  contactKeyToString,
  contactKeyToStringV1,
  legacyContactKeyToString,
  normalizeContactKeyStr,
  THOUGHT_CARDS,
  UserDataBackupSchema,
  GenerateReplyPayloadSchema,
  AnalyzeThoughtPayloadSchema,
  ConfigSchema,
  formatZodError,
} from '@social-copilot/core';
import type { ProviderType, LLMManagerConfig } from '@social-copilot/core';
import { interpolateCustomPrompt } from './custom-prompts';

const IS_RELEASE = __SC_RELEASE__;

type DiagnosticEventType =
  | 'GENERATE_REPLY'
  | 'ANALYZE_THOUGHT'
  | 'SET_CONFIG'
  | 'TEST_CONNECTION'
  | 'ACK_PRIVACY'
  | 'FALLBACK'
  | 'RECOVERY'
  | 'ALL_FAILED'
  | 'MEMORY_UPDATE'
  | 'BACKGROUND_ERROR'
  | 'ADAPTER_HEALTH'
  | 'CONTENT_SCRIPT_ERROR'
  | 'GET_STATUS'
  | 'GET_PROFILE'
  | 'UPDATE_PROFILE'
  | 'GET_CONTACT_MEMORY'
  | 'CLEAR_CONTACT_MEMORY'
  | 'RECORD_STYLE_SELECTION'
  | 'GET_STYLE_PREFERENCE'
  | 'RESET_STYLE_PREFERENCE'
  | 'EXPORT_PREFERENCES'
  | 'EXPORT_USER_DATA'
  | 'EXPORT_USER_DATA_JSON'
  | 'IMPORT_USER_DATA'
  | 'GET_CONTACTS'
  | 'GET_CONTACTS_WITH_PREFS'
  | 'CLEAR_DATA'
  | 'CLEAR_CONTACT_DATA'
  | 'SET_DEBUG_ENABLED'
  | 'GET_DIAGNOSTICS'
  | 'GET_DIAGNOSTICS_JSON'
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
  advancedMode?: boolean;
  apiKey: string;
  provider: ProviderType;
  /** 可选：覆盖 provider 默认 Base URL（不要包含 /v1） */
  baseUrl?: string;
  /** 允许 http Base URL（默认 false） */
  allowInsecureHttp?: boolean;
  /** 允许本地/私有地址（默认 false） */
  allowPrivateHosts?: boolean;
  /** 可选：指定模型名称（不填则使用 provider 默认） */
  model?: string;
  styles: ReplyStyle[];
  /** 回复语言：auto 推荐，按对话自动选择 */
  language?: 'zh' | 'en' | 'auto';
  /** 收到消息自动生成建议（默认 true；关闭后仅手动触发） */
  autoTrigger?: boolean;
  /** 是否在群聊中自动弹出（默认 false，仍可手动 Alt+S） */
  autoInGroups?: boolean;
  /** 自动代理：收到消息后自动生成并发送（默认 false） */
  autoAgent?: boolean;
  /** 自定义系统提示词（追加到系统提示词末尾） */
  customSystemPrompt?: string;
  /** 自定义用户提示词（追加到 user prompt 末尾） */
  customUserPrompt?: string;
  /** 发送给模型的最近消息条数（当前消息始终包含） */
  contextMessageLimit?: number;
  /** 发送前脱敏（邮箱/手机号/链接） */
  redactPii?: boolean;
  /** 发送前匿名化昵称（用“我/对方”替代） */
  anonymizeSenders?: boolean;
  /** 单条消息最大字符数 */
  maxCharsPerMessage?: number;
  /** 上下文总字符预算 */
  maxTotalChars?: number;
  /** 温度（0-100，UI 量化） */
  temperature?: number;
  fallbackProvider?: ProviderType;
  /** 可选：覆盖 fallback provider 默认 Base URL（不要包含 /v1） */
  fallbackBaseUrl?: string;
  /** 允许 fallback 的 http Base URL（默认 false） */
  fallbackAllowInsecureHttp?: boolean;
  /** 允许 fallback 本地/私有地址（默认 false） */
  fallbackAllowPrivateHosts?: boolean;
  /** 可选：指定备用模型名称（不填则使用 provider 默认） */
  fallbackModel?: string;
  fallbackApiKey?: string;
  enableFallback?: boolean;
  suggestionCount?: number;
  /** 是否启用长期记忆摘要（默认关闭） */
  enableMemory?: boolean;
  /** 是否持久化存储 API Key（默认不持久化以降低泄漏风险） */
  persistApiKey?: boolean;
  /** 用户是否已确认隐私告知（未确认则不调用第三方模型） */
  privacyAcknowledged?: boolean;
}

function applyReleaseRestrictions(config: Config): Config {
  if (!IS_RELEASE) return config;
  return {
    ...config,
    allowInsecureHttp: false,
    allowPrivateHosts: false,
    fallbackAllowInsecureHttp: false,
    fallbackAllowPrivateHosts: false,
  };
}

// 初始化存储
const store = new IndexedDBStore();
let storeReady: Promise<void> | null = null;
let storeInitError: Error | null = null;
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
/**
 * Temporary API key fallback keys stored in chrome.storage.local when
 * chrome.storage.session is unavailable (MV3 compatibility variance).
 *
 * These keys are cleared on browser startup to approximate session-only storage.
 */
const SESSION_API_KEY_FALLBACK_STORAGE_KEY = '__sc_session_apiKey';
const SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY = '__sc_session_fallbackApiKey';
const SESSION_KEYS_FALLBACK_TIMESTAMP_KEY = '__sc_session_key_ts';
const SESSION_KEYS_FALLBACK_TTL_MS = 1000 * 60 * 60;
/** Ring buffer size for exported diagnostics snapshot. */
const DIAGNOSTICS_MAX_EVENTS = 200;
/** Persist diagnostics across MV3 service worker restarts (local-only, no PII/raw chat text). */
const DIAGNOSTICS_STORAGE_KEY = '__sc_diagnostics_v1';
/** Throttle persistence to avoid excessive writes. */
const DIAGNOSTICS_PERSIST_MIN_INTERVAL_MS = 1500;
/** Update memory summary every N new messages (per contact) to control cost. */
const MEMORY_UPDATE_THRESHOLD = 50;
const MEMORY_CONTEXT_MESSAGE_LIMIT = 50;
const MEMORY_SUMMARY_MAX_LEN = 1024;

let debugEnabled = false;
let diagnostics: DiagnosticEvent[] = [];
let diagnosticsReady: Promise<void> | null = null;
let diagnosticsDirty = false;
let diagnosticsLastPersistAt = 0;
let diagnosticsPersistInFlight: Promise<void> | null = null;

function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    console.warn(...args);
  }
}

function debugWarn(...args: unknown[]): void {
  if (debugEnabled) {
    console.warn(...args);
  }
}

function debugError(...args: unknown[]): void {
  if (debugEnabled) {
    console.error(...args);
  }
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function summarizeConversationIdKind(conversationId: string): string {
  const id = (conversationId ?? '').trim();
  if (!id) return 'missing';
  if (id.includes('@g.us')) return 'wa_group_jid';
  if (id.includes('@c.us') || id.includes('@s.whatsapp.net')) return 'wa_dm_jid';
  if (id.startsWith('@')) return 'at_handle';
  if (/^-?\d+$/.test(id)) return 'numeric';
  if (/^[CDG][A-Z0-9]+$/.test(id)) return 'slack_like';
  return 'other';
}

function summarizePathnameKind(pathname: string): string {
  const path = (pathname ?? '').trim();
  if (!path || path === '/') return 'root';
  if (path.startsWith('/client/')) return 'slack_client';
  if (path.startsWith('/k/')) return 'telegram_k';
  if (path.startsWith('/a/')) return 'telegram_a';
  const seg = path.split('/').filter(Boolean)[0] ?? '';
  if (!seg) return 'other';
  const cleaned = seg.replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  return cleaned ? `seg:${cleaned}` : 'other';
}

function summarizeContactKeyStrForDiagnostics(contactKeyStr: string): Record<string, unknown> | null {
  const parts = (contactKeyStr ?? '').split(':').filter((p) => p !== undefined);
  if (parts.length < 5) return null;

  const groupOrDm = parts[parts.length - 1];
  if (groupOrDm !== 'group' && groupOrDm !== 'dm') return null;

  // v2: platform:app:accountId:conversationId:(group|dm)
  if (parts.length === 5) {
    const platform = safeDecodeURIComponent(parts[0] ?? '');
    const app = safeDecodeURIComponent(parts[1] ?? '');
    const accountId = safeDecodeURIComponent(parts[2] ?? '');
    const conversationId = safeDecodeURIComponent(parts[3] ?? '');

    return {
      platform,
      app,
      isGroup: groupOrDm === 'group',
      hasAccountId: Boolean(accountId),
      accountIdLen: accountId.length,
      conversationIdKind: summarizeConversationIdKind(conversationId),
      conversationIdLen: conversationId.length,
    };
  }

  // v1: platform:app:accountId:conversationId:peerId:(group|dm)
  if (parts.length === 6) {
    const platform = safeDecodeURIComponent(parts[0] ?? '');
    const app = safeDecodeURIComponent(parts[1] ?? '');
    const accountId = safeDecodeURIComponent(parts[2] ?? '');
    const conversationId = safeDecodeURIComponent(parts[3] ?? '');
    const peerId = safeDecodeURIComponent(parts[4] ?? '');

    return {
      platform,
      app,
      isGroup: groupOrDm === 'group',
      hasAccountId: Boolean(accountId),
      accountIdLen: accountId.length,
      conversationIdKind: summarizeConversationIdKind(conversationId),
      conversationIdLen: conversationId.length,
      peerIdLen: peerId.length,
    };
  }

  return null;
}

function summarizeContactKeyForDiagnostics(contactKey: ContactKey): Record<string, unknown> | null {
  try {
    const accountId = (contactKey.accountId ?? '').toString();
    const conversationId = (contactKey.conversationId ?? '').toString();
    const peerId = (contactKey.peerId ?? '').toString();

    return {
      platform: contactKey.platform,
      app: contactKey.app,
      isGroup: Boolean(contactKey.isGroup),
      hasAccountId: Boolean(accountId),
      accountIdLen: accountId.length,
      conversationIdKind: summarizeConversationIdKind(conversationId),
      conversationIdLen: conversationId.length,
      peerIdLen: peerId.length,
    };
  } catch {
    return null;
  }
}

function sanitizeDiagnosticDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = { ...details };

  // Strip potentially identifying URL paths (e.g. Slack channel IDs in /client/...).
  if (typeof out.pathname === 'string') {
    out.pathnameKind = summarizePathnameKind(out.pathname);
    out.pathnameLen = out.pathname.length;
    delete out.pathname;
  }

  // Legacy persisted diagnostics may include identifiers; migrate to safe summaries.
  if (typeof out.contactKey === 'string') {
    const summary = summarizeContactKeyStrForDiagnostics(out.contactKey);
    if (summary) out.contactKeySummary = summary;
    out.contactKeyLen = out.contactKey.length;
    delete out.contactKey;
  }

  if (Array.isArray(out.messages)) {
    out.messages = out.messages
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const rec = m as Record<string, unknown>;
        const next: Record<string, unknown> = { ...rec };
        if (typeof next.id === 'string') {
          next.idLen = next.id.length;
          delete next.id;
        }
        return next;
      })
      .filter((v): v is Record<string, unknown> => Boolean(v));
  }

  return out;
}

function pushDiagnostic(event: DiagnosticEvent): void {
  const sanitized: DiagnosticEvent = event.details ? { ...event, details: sanitizeDiagnosticDetails(event.details) } : event;
  diagnostics.push(sanitized);
  if (diagnostics.length > DIAGNOSTICS_MAX_EVENTS) {
    diagnostics = diagnostics.slice(-DIAGNOSTICS_MAX_EVENTS);
  }
  diagnosticsDirty = true;
}

function coerceDiagnosticEventType(value: unknown): DiagnosticEventType {
  if (typeof value !== 'string') return 'UNKNOWN';
  switch (value) {
    case 'GENERATE_REPLY':
    case 'ANALYZE_THOUGHT':
    case 'SET_CONFIG':
    case 'TEST_CONNECTION':
    case 'ACK_PRIVACY':
    case 'FALLBACK':
    case 'RECOVERY':
    case 'ALL_FAILED':
    case 'MEMORY_UPDATE':
    case 'BACKGROUND_ERROR':
    case 'ADAPTER_HEALTH':
    case 'CONTENT_SCRIPT_ERROR':
    case 'GET_STATUS':
    case 'GET_PROFILE':
    case 'UPDATE_PROFILE':
    case 'GET_CONTACT_MEMORY':
    case 'CLEAR_CONTACT_MEMORY':
    case 'RECORD_STYLE_SELECTION':
    case 'GET_STYLE_PREFERENCE':
    case 'RESET_STYLE_PREFERENCE':
    case 'EXPORT_PREFERENCES':
    case 'EXPORT_USER_DATA':
    case 'IMPORT_USER_DATA':
    case 'GET_CONTACTS':
    case 'CLEAR_DATA':
    case 'CLEAR_CONTACT_DATA':
    case 'SET_DEBUG_ENABLED':
    case 'GET_DIAGNOSTICS':
    case 'CLEAR_DIAGNOSTICS':
    case 'UNKNOWN':
      return value;
    default:
      return 'UNKNOWN';
  }
}

function parseDiagnosticsPayload(raw: unknown): DiagnosticEvent[] {
  if (!Array.isArray(raw)) return [];

  const events: DiagnosticEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const ts = typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : null;
    const ok = typeof record.ok === 'boolean' ? record.ok : null;
    const requestId = typeof record.requestId === 'string' ? record.requestId : null;
    const type = coerceDiagnosticEventType(record.type);
    if (ts === null || ok === null || requestId === null) continue;

    const durationMs = typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
      ? record.durationMs
      : undefined;
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? sanitizeDiagnosticDetails(record.details as Record<string, unknown>)
      : undefined;
    const error = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? (() => {
          const e = record.error as Record<string, unknown>;
          const name = typeof e.name === 'string' ? e.name : 'Error';
          const message = typeof e.message === 'string' ? redactSecrets(e.message) : '';
          const stack = typeof e.stack === 'string' ? redactSecrets(e.stack) : undefined;
          return { name, message, stack };
        })()
      : undefined;

    events.push({
      ts,
      type,
      requestId,
      ok,
      durationMs,
      details,
      error,
    });
  }

  return events.slice(-DIAGNOSTICS_MAX_EVENTS);
}

async function ensureDiagnosticsReady(): Promise<void> {
  if (!diagnosticsReady) {
    diagnosticsReady = (async () => {
      try {
        const result = await storageLocalGet([DIAGNOSTICS_STORAGE_KEY]);
        diagnostics = parseDiagnosticsPayload(result[DIAGNOSTICS_STORAGE_KEY]);
      } catch (err) {
        debugWarn('[Social Copilot] Failed to load diagnostics:', err);
      }
    })();
  }
  return diagnosticsReady;
}

async function maybePersistDiagnostics(force = false): Promise<void> {
  if (!diagnosticsDirty) return;

  const now = Date.now();
  if (!force && now - diagnosticsLastPersistAt < DIAGNOSTICS_PERSIST_MIN_INTERVAL_MS) return;
  if (diagnosticsPersistInFlight) {
    await diagnosticsPersistInFlight;
    return;
  }

  const snapshot = diagnostics.slice(-DIAGNOSTICS_MAX_EVENTS);
  diagnosticsPersistInFlight = (async () => {
    diagnosticsDirty = false;
    diagnosticsLastPersistAt = Date.now();
    try {
      await storageLocalSet({ [DIAGNOSTICS_STORAGE_KEY]: snapshot });
    } catch (err) {
      diagnosticsDirty = true;
      debugWarn('[Social Copilot] Failed to persist diagnostics:', err);
    } finally {
      diagnosticsPersistInFlight = null;
    }
  })();

  await diagnosticsPersistInFlight;
}

async function clearPersistedDiagnostics(): Promise<void> {
  const inFlight = diagnosticsPersistInFlight;
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // ignore
    }
  }
  diagnostics = [];
  diagnosticsDirty = false;
  diagnosticsLastPersistAt = Date.now();
  diagnosticsPersistInFlight = null;
  try {
    await storageLocalRemove([DIAGNOSTICS_STORAGE_KEY]);
  } catch (err) {
    debugWarn('[Social Copilot] Failed to clear persisted diagnostics:', err);
  }
}

function setupBackgroundErrorReporting(): void {
  const report = (error: unknown, details: Record<string, unknown>) => {
    void ensureDiagnosticsReady()
      .then(() => {
        pushDiagnostic({
          ts: Date.now(),
          type: 'BACKGROUND_ERROR',
          requestId: generateRequestId(),
          ok: false,
          details,
          error: sanitizeErrorForDiagnostics(error),
        });
        void maybePersistDiagnostics(true);
      })
      .catch(() => {
        // ignore
      });
  };

  self.addEventListener('error', (event) => {
    const errEvent = event as ErrorEvent;
    report(errEvent.error ?? errEvent.message, {
      phase: 'background_error',
      filename: errEvent.filename,
      lineno: errEvent.lineno,
      colno: errEvent.colno,
    });
  });

  self.addEventListener('unhandledrejection', (event) => {
    const rejEvent = event as PromiseRejectionEvent;
    report(rejEvent.reason, {
      phase: 'unhandledrejection',
    });
  });
}

function sanitizeErrorForDiagnostics(error: unknown): { name: string; message: string; stack?: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    name: err.name,
    message: redactSecrets(err.message),
    stack: err.stack ? redactSecrets(err.stack) : undefined,
  };
}

function sanitizeConfig(config: Config | null): Record<string, unknown> {
  if (!config) return { configured: false };
  return {
    configured: true,
    provider: config.provider,
    model: config.model,
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    allowPrivateHosts: config.allowPrivateHosts ?? false,
    styles: config.styles,
    language: config.language ?? 'auto',
    autoTrigger: config.autoTrigger ?? true,
    autoInGroups: config.autoInGroups ?? false,
    autoAgent: config.autoAgent ?? false,
    enableFallback: config.enableFallback ?? false,
    fallbackProvider: config.fallbackProvider,
    fallbackModel: config.fallbackModel,
    fallbackAllowInsecureHttp: config.fallbackAllowInsecureHttp ?? false,
    fallbackAllowPrivateHosts: config.fallbackAllowPrivateHosts ?? false,
    suggestionCount: normalizeSuggestionCount(config.suggestionCount),
    enableMemory: config.enableMemory ?? false,
    persistApiKey: config.persistApiKey ?? false,
    privacyAcknowledged: config.privacyAcknowledged ?? false,
    privacy: {
      redactPii: config.redactPii ?? true,
      anonymizeSenders: config.anonymizeSenders ?? true,
      contextMessageLimit: config.contextMessageLimit,
      maxCharsPerMessage: config.maxCharsPerMessage,
      maxTotalChars: config.maxTotalChars,
    },
    prompts: {
      hasCustomSystemPrompt: Boolean(config.customSystemPrompt?.trim()),
      hasCustomUserPrompt: Boolean(config.customUserPrompt?.trim()),
      customSystemPromptLength: (config.customSystemPrompt ?? '').length,
      customUserPromptLength: (config.customUserPrompt ?? '').length,
    },
    hasApiKey: Boolean(config.apiKey?.trim()),
    hasFallbackApiKey: Boolean(config.fallbackApiKey?.trim()),
  };
}

function normalizeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLanguage(value: unknown): 'zh' | 'en' | 'auto' {
  return value === 'zh' || value === 'en' || value === 'auto' ? value : 'auto';
}

function normalizeOptionalInt(value: unknown, opts: { min: number; max: number }): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  if (i < opts.min || i > opts.max) return undefined;
  return i;
}

function buildOutboundPrivacyOptions(config: Config | null) {
  return {
    maxRecentMessages: normalizeOptionalInt(config?.contextMessageLimit, { min: 1, max: 50 }) ?? 10,
    maxCharsPerMessage: normalizeOptionalInt(config?.maxCharsPerMessage, { min: 50, max: 4000 }) ?? 500,
    maxTotalChars: normalizeOptionalInt(config?.maxTotalChars, { min: 200, max: 20_000 }) ?? 4000,
    redactPii: config?.redactPii ?? true,
    anonymizeSenderNames: config?.anonymizeSenders ?? true,
  } as const;
}

function buildSanitizedOutboundContext(
  contactKey: ContactKey,
  recentMessages: Message[],
  currentMessage: Message
): ConversationContext {
  const dedupedRecent = recentMessages.filter((m) => m.id !== currentMessage.id);
  return sanitizeOutboundContext(
    {
      contactKey,
      recentMessages: dedupedRecent,
      currentMessage,
    },
    buildOutboundPrivacyOptions(currentConfig)
  );
}

function countRegexMatches(text: string, re: RegExp): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function resolveLanguage(
  configured: 'zh' | 'en' | 'auto' | undefined,
  currentMessage: Message,
  recentMessages: Message[]
): 'zh' | 'en' {
  const lang = normalizeLanguage(configured);
  if (lang !== 'auto') return lang;

  // Prefer the other party's recent messages to avoid "my last message was in EN but they replied in ZH" cases.
  // Use current incoming message as the strongest signal when available.
  const incoming = [
    ...(currentMessage.direction === 'incoming' ? [currentMessage] : []),
    ...recentMessages.filter((m) => m.direction === 'incoming').slice(-10),
  ];

  const sampleSource = incoming.length ? incoming : [currentMessage, ...recentMessages.slice(-10)];
  const sample = sampleSource.map((m) => m.text).join('\n');
  const cjk = countRegexMatches(sample, /[\u4e00-\u9fff]/g);
  const latin = countRegexMatches(sample, /[A-Za-z]/g);

  if (cjk === 0 && latin === 0) return 'zh';
  return cjk >= latin ? 'zh' : 'en';
}

function getContactKeyStrCandidates(contactKey: ContactKey): string[] {
  const variants: ContactKey[] = [contactKey];

  // Backward-compat: older versions may not include accountId in keys.
  if (contactKey.accountId) {
    variants.push({ ...contactKey, accountId: undefined });
  }

  // Backward-compat: some adapters historically used peerId/displayName as conversationId (not stable).
  // Scope this heuristic to WhatsApp to avoid accidental cross-channel matches on other platforms.
  if (contactKey.app === 'whatsapp' && contactKey.peerId && contactKey.conversationId !== contactKey.peerId) {
    variants.push({ ...contactKey, conversationId: contactKey.peerId });
    if (contactKey.accountId) {
      variants.push({ ...contactKey, accountId: undefined, conversationId: contactKey.peerId });
    }
  }

  const keys = variants.flatMap((key) => [
    contactKeyToString(key),
    contactKeyToStringV1(key),
    legacyContactKeyToString(key),
  ]);

  return Array.from(new Set(keys));
}

function getProviderDefaultModel(provider: ProviderType): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5.2-chat-latest';
    case 'claude':
      return 'claude-sonnet-4-5';
    case 'builtin':
      return BUILTIN_MODEL;
    case 'deepseek':
    default:
      return 'deepseek-v3.2';
  }
}

async function setSessionKeys(apiKey: string, fallbackApiKey?: string): Promise<void> {
  const payload: Record<string, unknown> = { apiKey };
  if (fallbackApiKey) payload.fallbackApiKey = fallbackApiKey;
  const writtenToSession = await storageSessionSet(payload);
  if (writtenToSession) {
    if (!fallbackApiKey) {
      await storageSessionRemove(['fallbackApiKey']);
    }
    return;
  }

  // Fallback: store session keys in local storage and clear them on browser startup.
  const localPayload: Record<string, unknown> = {
    [SESSION_API_KEY_FALLBACK_STORAGE_KEY]: apiKey,
    [SESSION_KEYS_FALLBACK_TIMESTAMP_KEY]: Date.now(),
  };
  if (fallbackApiKey) localPayload[SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY] = fallbackApiKey;
  await storageLocalSet(localPayload);
  if (!fallbackApiKey) {
    await storageLocalRemove([SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY]);
  }
}

async function getSessionKeys(): Promise<{ apiKey?: string; fallbackApiKey?: string }> {
  const result = await storageSessionGet(['apiKey', 'fallbackApiKey']);
  if (result) {
    return {
      apiKey: typeof result.apiKey === 'string' ? (result.apiKey as string) : undefined,
      fallbackApiKey: typeof result.fallbackApiKey === 'string' ? (result.fallbackApiKey as string) : undefined,
    };
  }

  const local = await storageLocalGet([
    SESSION_API_KEY_FALLBACK_STORAGE_KEY,
    SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY,
    SESSION_KEYS_FALLBACK_TIMESTAMP_KEY,
  ]);

  const storedAt = typeof local[SESSION_KEYS_FALLBACK_TIMESTAMP_KEY] === 'number'
    ? (local[SESSION_KEYS_FALLBACK_TIMESTAMP_KEY] as number)
    : undefined;
  if (!storedAt || Date.now() - storedAt > SESSION_KEYS_FALLBACK_TTL_MS) {
    await storageLocalRemove([
      SESSION_API_KEY_FALLBACK_STORAGE_KEY,
      SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY,
      SESSION_KEYS_FALLBACK_TIMESTAMP_KEY,
    ]);
    return {};
  }

  return {
    apiKey: typeof local[SESSION_API_KEY_FALLBACK_STORAGE_KEY] === 'string'
      ? (local[SESSION_API_KEY_FALLBACK_STORAGE_KEY] as string)
      : undefined,
    fallbackApiKey: typeof local[SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY] === 'string'
      ? (local[SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY] as string)
      : undefined,
  };
}

async function clearSessionKeys(): Promise<void> {
  await storageSessionRemove(['apiKey', 'fallbackApiKey']);
  await storageLocalRemove([
    SESSION_API_KEY_FALLBACK_STORAGE_KEY,
    SESSION_FALLBACK_API_KEY_FALLBACK_STORAGE_KEY,
    SESSION_KEYS_FALLBACK_TIMESTAMP_KEY,
  ]);
}

function buildDiagnosticsSnapshot(): Record<string, unknown> {
  return {
    version: runtimeGetManifestVersion(),
    debugEnabled,
    maxEvents: DIAGNOSTICS_MAX_EVENTS,
    eventCount: diagnostics.length,
    events: diagnostics,
    storeOk: storeInitError === null,
    storeError: storeInitError
      ? { name: storeInitError.name, message: redactSecrets(storeInitError.message) }
      : undefined,
    config: sanitizeConfig(currentConfig),
  };
}

async function loadDebugEnabled(): Promise<void> {
  try {
    const result = await storageLocalGet(DEBUG_ENABLED_STORAGE_KEY);
    debugEnabled = Boolean(result[DEBUG_ENABLED_STORAGE_KEY]);
  } catch (err) {
    debugWarn('[Social Copilot] Failed to load debug flag:', err);
  }
}

async function loadProfileUpdateCounts(): Promise<void> {
  try {
    const result = await storageLocalGet(PROFILE_UPDATE_COUNT_STORAGE_KEY);
    const stored = result[PROFILE_UPDATE_COUNT_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          const normalizedKey = normalizeContactKeyStr(key);
          const prev = lastProfileUpdateCount.get(normalizedKey);
          if (prev === undefined || value > prev) {
            lastProfileUpdateCount.set(normalizedKey, value);
          }
        }
      }
    }
  } catch (err) {
    debugWarn('[Social Copilot] Failed to load profile update counts:', err);
  }
}

async function persistProfileUpdateCounts(): Promise<void> {
  const payload: Record<string, number> = {};
  for (const [key, value] of lastProfileUpdateCount.entries()) {
    payload[key] = value;
  }
  await storageLocalSet({ [PROFILE_UPDATE_COUNT_STORAGE_KEY]: payload });
}

async function setLastProfileUpdateCount(contactKeyStr: string, count: number): Promise<void> {
  lastProfileUpdateCount.set(contactKeyStr, count);
  try {
    await persistProfileUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist profile update counts:', err);
  }
}

async function loadMemoryUpdateCounts(): Promise<void> {
  try {
    const result = await storageLocalGet(MEMORY_UPDATE_COUNT_STORAGE_KEY);
    const stored = result[MEMORY_UPDATE_COUNT_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          const normalizedKey = normalizeContactKeyStr(key);
          const prev = lastMemoryUpdateCount.get(normalizedKey);
          if (prev === undefined || value > prev) {
            lastMemoryUpdateCount.set(normalizedKey, value);
          }
        }
      }
    }
  } catch (err) {
    debugWarn('[Social Copilot] Failed to load memory update counts:', err);
  }
}

async function persistMemoryUpdateCounts(): Promise<void> {
  const payload: Record<string, number> = {};
  for (const [key, value] of lastMemoryUpdateCount.entries()) {
    payload[key] = value;
  }
  await storageLocalSet({ [MEMORY_UPDATE_COUNT_STORAGE_KEY]: payload });
}

async function setLastMemoryUpdateCount(contactKeyStr: string, count: number): Promise<void> {
  lastMemoryUpdateCount.set(contactKeyStr, count);
  try {
    await persistMemoryUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist memory update counts:', err);
  }
}

function ensureStoreReady(): Promise<void> {
  if (!storeReady) {
    storeReady = (async () => {
      try {
        await store.init();
        preferenceManager = new StylePreferenceManager(store);
        await loadProfileUpdateCounts();
        await loadMemoryUpdateCounts();
        await loadDebugEnabled();
        storeInitError = null;
      } catch (err) {
        storeInitError = err instanceof Error ? err : new Error(String(err));
        throw storeInitError;
      }
    })().catch((err) => {
      storeReady = null;
      throw err;
    });
  }
  return storeReady;
}

// 初始化
addRuntimeOnInstalledListener(async () => {
  debugLog('[Social Copilot] Extension installed');
  await ensureStoreReady();
  await loadConfig();
});

addRuntimeOnStartupListener(() => {
  // Ensure session-only keys do not survive browser restarts (fallback path stores them in local).
  void clearSessionKeys();
});

// 启动时初始化
ensureStoreReady()
  .catch((err) => debugError('[Social Copilot] Init failed:', sanitizeErrorForDiagnostics(err)));
void ensureDiagnosticsReady();
setupBackgroundErrorReporting();

// 监听消息
addRuntimeOnMessageListener((request, sender, sendResponse) => {
  const runtimeId = runtimeGetId();
  const senderId =
    sender && typeof sender === 'object' && 'id' in (sender as Record<string, unknown>)
      ? (sender as Record<string, unknown>).id
      : undefined;

  // Reject cross-extension messages (prevents other installed extensions from invoking privileged handlers).
  if (runtimeId && typeof senderId === 'string' && senderId !== runtimeId) {
    sendResponse({ error: 'Unauthorized message sender' });
    return false;
  }

  handleMessage(request as { type: string; [key: string]: unknown })
    .then(sendResponse)
    .catch((error) => {
      debugError('[Social Copilot] Error:', sanitizeErrorForDiagnostics(error));
      sendResponse({ error: toUserErrorMessage(error) });
    });
  return true;
});

function sanitizeMessageForLocalStore(message: Message, includeText: boolean): Message {
  const senderName = message.direction === 'incoming' ? '对方' : '我';
  const base: Message = { ...message, senderName, raw: undefined };

  if (!includeText) {
    return { ...base, text: '' };
  }

  const rawText = typeof message.text === 'string' ? message.text : String(message.text ?? '');
  const text = redactPii(rawText).slice(0, 500);
  return { ...base, text };
}

async function handleMessage(request: { type: string; [key: string]: unknown }) {
  await ensureDiagnosticsReady();
  const requestType = typeof request.type === 'string' ? request.type : 'UNKNOWN';
  const allowWithoutStore = new Set([
    'GET_STATUS',
    'CLEAR_DATA',
    'GET_DIAGNOSTICS',
    'GET_DIAGNOSTICS_JSON',
    'CLEAR_DIAGNOSTICS',
    'SET_DEBUG_ENABLED',
    'REPORT_ADAPTER_HEALTH',
    'REPORT_CONTENT_SCRIPT_ERROR',
  ]);

  if (allowWithoutStore.has(requestType)) {
    try {
      await ensureStoreReady();
    } catch {
      // Allow limited recovery/diagnostics even if IndexedDB init/migration fails.
      // This ensures the extension can still export diagnostics and offer a self-healing
      // "clear data" path instead of getting permanently bricked by a migration failure.
    }
  } else {
    await ensureStoreReady();
  }

  const requestId = typeof request.requestId === 'string' && request.requestId.trim()
    ? request.requestId.trim()
    : generateRequestId();
  const startedAt = Date.now();
  const diagType = normalizeDiagnosticType(request.type);

  const record = (event: Omit<DiagnosticEvent, 'requestId'>) => {
    const safeEvent: Omit<DiagnosticEvent, 'requestId'> = {
      ...event,
      details: sanitizeDiagnosticDetails(event.details),
    };
    pushDiagnostic({ ...safeEvent, requestId });
    if (debugEnabled) {
      const label = event.ok ? 'ok' : 'err';
      debugLog(`[Social Copilot][diag][${label}]`, event.type, requestId, safeEvent.details ?? safeEvent.error ?? {});
    }
  };

  try {
    const result = await dispatchMessage(requestId, request);
    if (
      diagType !== 'ADAPTER_HEALTH' &&
      diagType !== 'CONTENT_SCRIPT_ERROR' &&
      diagType !== 'CLEAR_DIAGNOSTICS' &&
      diagType !== 'CLEAR_DATA'
    ) {
      record({
        ts: Date.now(),
        type: diagType,
        ok: true,
        durationMs: Date.now() - startedAt,
        details: debugEnabled ? buildSuccessDetails(request, result) : buildMinimalSuccessDetails(request, result),
      });
    }
    await maybePersistDiagnostics();
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const safeErr = sanitizeErrorForDiagnostics(err);
    if (
      diagType !== 'ADAPTER_HEALTH' &&
      diagType !== 'CONTENT_SCRIPT_ERROR' &&
      diagType !== 'CLEAR_DIAGNOSTICS' &&
      diagType !== 'CLEAR_DATA'
    ) {
      record({
        ts: Date.now(),
        type: diagType,
        ok: false,
        durationMs: Date.now() - startedAt,
        details: debugEnabled ? buildErrorDetails(request) : buildMinimalErrorDetails(request),
        error: safeErr,
      });
    }
    await maybePersistDiagnostics();
    throw err;
  }
}

type StoredConfigRecord = Record<string, unknown> &
  Partial<{
    apiKey: string;
    provider: ProviderType;
    baseUrl: string;
    allowInsecureHttp: boolean;
    allowPrivateHosts: boolean;
    model: string;
    styles: ReplyStyle[];
    language: 'zh' | 'en' | 'auto';
    autoTrigger: boolean;
    autoInGroups: boolean;
    autoAgent: boolean;
    customSystemPrompt: string;
    customUserPrompt: string;
    privacyAcknowledged: boolean;
    redactPii: boolean;
    anonymizeSenders: boolean;
    contextMessageLimit: number | string;
    maxCharsPerMessage: number | string;
    maxTotalChars: number | string;
    temperature: number | string;
    fallbackProvider: ProviderType;
    fallbackBaseUrl: string;
    fallbackAllowInsecureHttp: boolean;
    fallbackAllowPrivateHosts: boolean;
    fallbackModel: string;
    fallbackApiKey: string;
    enableFallback: boolean;
    suggestionCount: number;
    persistApiKey: boolean;
    enableMemory: boolean;
  }>;

function normalizeDiagnosticType(type: string): DiagnosticEventType {
  switch (type) {
    case 'GENERATE_REPLY':
    case 'ANALYZE_THOUGHT':
    case 'SET_CONFIG':
    case 'TEST_CONNECTION':
    case 'ACK_PRIVACY':
    case 'GET_STATUS':
    case 'GET_PROFILE':
    case 'UPDATE_PROFILE':
    case 'GET_CONTACT_MEMORY':
    case 'CLEAR_CONTACT_MEMORY':
    case 'RECORD_STYLE_SELECTION':
    case 'GET_STYLE_PREFERENCE':
    case 'RESET_STYLE_PREFERENCE':
    case 'EXPORT_PREFERENCES':
    case 'EXPORT_USER_DATA':
    case 'EXPORT_USER_DATA_JSON':
    case 'IMPORT_USER_DATA':
    case 'GET_CONTACTS':
    case 'GET_CONTACTS_WITH_PREFS':
    case 'CLEAR_DATA':
    case 'CLEAR_CONTACT_DATA':
    case 'SET_DEBUG_ENABLED':
    case 'GET_DIAGNOSTICS':
    case 'GET_DIAGNOSTICS_JSON':
    case 'CLEAR_DIAGNOSTICS':
      return type;
    case 'REPORT_ADAPTER_HEALTH':
      return 'ADAPTER_HEALTH';
    case 'REPORT_CONTENT_SCRIPT_ERROR':
      return 'CONTENT_SCRIPT_ERROR';
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
  if (request.type === 'TEST_CONNECTION') {
    const r = result as { primary?: { ok?: boolean; provider?: string }; fallback?: { ok?: boolean; provider?: string } };
    return {
      primaryOk: r.primary?.ok,
      primaryProvider: r.primary?.provider,
      fallbackOk: r.fallback?.ok,
      fallbackProvider: r.fallback?.provider,
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
      contactKeySummary: payload?.contactKey ? summarizeContactKeyForDiagnostics(payload.contactKey) : undefined,
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
      contactKeySummary: payload?.contactKey ? summarizeContactKeyForDiagnostics(payload.contactKey) : undefined,
      messageCount: Array.isArray(payload?.messages) ? payload!.messages.length : undefined,
      messages: Array.isArray(payload?.messages)
        ? payload!.messages.map((m) => ({
            idLen: (m.id ?? '').length,
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
    case 'GENERATE_REPLY': {
      // Validate payload using Zod schema
      const validationResult = GenerateReplyPayloadSchema.safeParse(request.payload);
      if (!validationResult.success) {
        const errorMessage = formatZodError(validationResult.error);
        return { error: `GENERATE_REPLY 请求参数验证失败：${errorMessage}` };
      }
      return handleGenerateReply(validationResult.data);
    }

    case 'ANALYZE_THOUGHT': {
      // Validate payload using Zod schema
      const validationResult = AnalyzeThoughtPayloadSchema.safeParse(request.payload);
      if (!validationResult.success) {
        const errorMessage = formatZodError(validationResult.error);
        return { error: `ANALYZE_THOUGHT 请求参数验证失败：${errorMessage}` };
      }
      return handleAnalyzeThought(validationResult.data);
    }

    case 'SET_API_KEY':
      // 兼容旧版本
      return setConfig({
        apiKey: request.apiKey as string,
        provider: 'deepseek',
        styles: DEFAULT_STYLES,
      });

    case 'TEST_CONNECTION': {
      const validationResult = ConfigSchema.safeParse(request.config);
      if (!validationResult.success) {
        const errorMessage = formatZodError(validationResult.error);
        return { error: `TEST_CONNECTION 配置验证失败：${errorMessage}` };
      }

      const config = applyReleaseRestrictions(validationResult.data as Config);
      const testInput: LLMInput = {
        context: {
          contactKey: {
            platform: 'web',
            app: 'other',
            conversationId: 'test-connection',
            peerId: 'test-peer',
            isGroup: false,
          },
          recentMessages: [],
          currentMessage: {
            id: 'test-message',
            contactKey: {
              platform: 'web',
              app: 'other',
              conversationId: 'test-connection',
              peerId: 'test-peer',
              isGroup: false,
            },
            direction: 'incoming',
            senderName: 'Test',
            text: 'ping',
            timestamp: Date.now(),
          },
        },
        styles: sanitizeStyles(config.styles),
        language: normalizeLanguage(config.language),
        temperature: 0,
        maxLength: 16,
        task: 'reply',
      };

      const runOne = async (cfg: LLMManagerConfig['primary']) => {
        const startedAt = Date.now();
        const manager = new LLMManager(
          { primary: cfg, cache: { enabled: false } },
          {},
          buildPromptHookRegistry(config)
        );
        try {
          const res = await manager.generateReply(testInput);
          return { ok: true, provider: cfg.provider, model: res.model, latencyMs: Date.now() - startedAt };
        } catch (err) {
          return { ok: false, provider: cfg.provider, error: redactSecrets((err as Error).message), latencyMs: Date.now() - startedAt };
        }
      };

      const inferredAdvancedMode = config.advancedMode ?? (config.provider !== 'builtin');
      const isBuiltin = !inferredAdvancedMode || config.provider === 'builtin';
      const primary = await runOne({
        provider: isBuiltin ? 'builtin' : config.provider,
        apiKey: config.apiKey,
        model: isBuiltin ? BUILTIN_MODEL : normalizeModel(config.model),
        baseUrl: isBuiltin ? undefined : normalizeBaseUrl(config.baseUrl),
        allowInsecureHttp: config.allowInsecureHttp ?? false,
        allowPrivateHosts: config.allowPrivateHosts ?? false,
      });

      const fallbackEnabled = (config.enableFallback ?? false) && Boolean((config.fallbackApiKey ?? '').trim());
      const fallback = fallbackEnabled
        ? await runOne({
            provider: (config.fallbackProvider || config.provider) as ProviderType,
            apiKey: (config.fallbackApiKey as string) || '',
            model: normalizeModel(config.fallbackModel),
            baseUrl: normalizeBaseUrl(config.fallbackBaseUrl),
            allowInsecureHttp: config.fallbackAllowInsecureHttp ?? false,
            allowPrivateHosts: config.fallbackAllowPrivateHosts ?? false,
          })
        : undefined;

      return { primary, fallback, requestId };
    }

    case 'SET_CONFIG': {
      // Validate config using Zod schema
      const validationResult = ConfigSchema.safeParse(request.config);
      if (!validationResult.success) {
        const errorMessage = formatZodError(validationResult.error);
        return { error: `SET_CONFIG 配置验证失败：${errorMessage}` };
      }
      return setConfig(validationResult.data);
    }

    case 'ACK_PRIVACY': {
      const acknowledged = true;
      try {
        await storageLocalSet({ privacyAcknowledged: acknowledged });
      } catch {
        // ignore
      }
      if (currentConfig) {
        currentConfig = { ...currentConfig, privacyAcknowledged: acknowledged };
      }
      return { success: true, privacyAcknowledged: acknowledged };
    }

    case 'SET_DEBUG_ENABLED': {
      debugEnabled = Boolean(request.enabled);
      await storageLocalSet({ [DEBUG_ENABLED_STORAGE_KEY]: debugEnabled });
      return { success: true, debugEnabled };
    }

    case 'GET_DIAGNOSTICS':
      return buildDiagnosticsSnapshot();

    case 'GET_DIAGNOSTICS_JSON': {
      const pretty = Boolean(request.pretty);
      const snapshot = buildDiagnosticsSnapshot();
      return { json: JSON.stringify(snapshot, null, pretty ? 2 : 0) };
    }

    case 'CLEAR_DIAGNOSTICS':
      await clearPersistedDiagnostics();
      return { success: true };

    case 'GET_STATUS': {
      if (!llmManager || !currentConfig) {
        try {
          await loadConfig();
        } catch (err) {
          debugWarn('[Social Copilot] Failed to load config for status:', sanitizeErrorForDiagnostics(err));
        }
      }
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
        privacyAcknowledged: currentConfig?.privacyAcknowledged ?? false,
        autoTrigger: currentConfig?.autoTrigger ?? true,
        storeOk: storeInitError === null,
        storeError: storeInitError
          ? { name: storeInitError.name, message: storeInitError.message }
          : undefined,
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

    case 'EXPORT_USER_DATA':
      return exportUserData();

    case 'EXPORT_USER_DATA_JSON': {
      const pretty = Boolean(request.pretty);
      const { backup } = await exportUserData();
      return { json: JSON.stringify(backup, null, pretty ? 2 : 0) };
    }

    case 'IMPORT_USER_DATA':
      return importUserData(request.data);

    case 'GET_CONTACTS':
      return getContacts();

    case 'GET_CONTACTS_WITH_PREFS':
      return getContactsWithPrefs();

    case 'CLEAR_DATA':
      return clearData();

    case 'CLEAR_CONTACT_DATA':
      return clearContactData(request.contactKey as ContactKey);

    case 'OPEN_OPTIONS_PAGE': {
      runtimeOpenOptionsPage();
      return { success: true };
    }

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
          pathnameKind: payload?.pathnameKind,
          pathnameLen: payload?.pathnameLen,
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

    case 'REPORT_CONTENT_SCRIPT_ERROR': {
      const payload = request.payload as Record<string, unknown> | undefined;
      const name = typeof payload?.name === 'string' ? payload.name : 'ContentScriptError';
      const message = typeof payload?.message === 'string' ? redactSecrets(payload.message) : 'unknown';
      const stack = typeof payload?.stack === 'string' ? redactSecrets(payload.stack) : undefined;

      pushDiagnostic({
        ts: Date.now(),
        type: 'CONTENT_SCRIPT_ERROR',
        requestId,
        ok: false,
        details: {
          app: payload?.app,
          host: payload?.host,
          pathnameKind: payload?.pathnameKind,
          pathnameLen: payload?.pathnameLen,
          phase: payload?.phase,
          filename: payload?.filename,
          lineno: payload?.lineno,
          colno: payload?.colno,
        },
        error: {
          name,
          message,
          stack,
        },
      });
      return { success: true };
    }

    default:
      return { error: 'Unknown message type', requestId };
  }
}

async function loadConfig() {
  const result = await storageLocalGet<StoredConfigRecord>([
    'apiKey',
    'provider',
    'baseUrl',
    'allowInsecureHttp',
    'allowPrivateHosts',
    'model',
    'styles',
    'language',
    'autoTrigger',
    'autoInGroups',
    'autoAgent',
    'customSystemPrompt',
    'customUserPrompt',
    'privacyAcknowledged',
    'redactPii',
    'anonymizeSenders',
    'contextMessageLimit',
    'maxCharsPerMessage',
    'maxTotalChars',
    'temperature',
    'fallbackProvider',
    'fallbackBaseUrl',
    'fallbackAllowInsecureHttp',
    'fallbackAllowPrivateHosts',
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
      advancedMode: typeof result.advancedMode === 'boolean' ? result.advancedMode : undefined,
      provider: result.provider || 'deepseek',
      baseUrl: normalizeBaseUrl(result.baseUrl),
      allowInsecureHttp: result.allowInsecureHttp === true,
      allowPrivateHosts: result.allowPrivateHosts === true,
      model: normalizeModel(result.model),
      styles: (result.styles as ReplyStyle[] | undefined) || DEFAULT_STYLES,
      language: normalizeLanguage(result.language),
      autoTrigger: result.autoTrigger === undefined ? true : Boolean(result.autoTrigger),
      autoInGroups: Boolean(result.autoInGroups),
      autoAgent: Boolean(result.autoAgent),
      customSystemPrompt: typeof result.customSystemPrompt === 'string' ? result.customSystemPrompt : undefined,
      customUserPrompt: typeof result.customUserPrompt === 'string' ? result.customUserPrompt : undefined,
      privacyAcknowledged: result.privacyAcknowledged === undefined ? false : Boolean(result.privacyAcknowledged),
      redactPii: result.redactPii === undefined ? true : Boolean(result.redactPii),
      anonymizeSenders: result.anonymizeSenders === undefined ? true : Boolean(result.anonymizeSenders),
      contextMessageLimit: normalizeOptionalInt(result.contextMessageLimit, { min: 1, max: 50 }),
      maxCharsPerMessage: normalizeOptionalInt(result.maxCharsPerMessage, { min: 50, max: 4000 }),
      maxTotalChars: normalizeOptionalInt(result.maxTotalChars, { min: 200, max: 20_000 }),
      temperature: normalizeOptionalInt(result.temperature, { min: 0, max: 100 }),
      fallbackProvider: result.fallbackProvider,
      fallbackBaseUrl: normalizeBaseUrl(result.fallbackBaseUrl),
      fallbackAllowInsecureHttp: result.fallbackAllowInsecureHttp === true,
      fallbackAllowPrivateHosts: result.fallbackAllowPrivateHosts === true,
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
  const enforced = applyReleaseRestrictions(config);
  const inferredAdvancedMode = enforced.advancedMode ?? (enforced.provider !== 'builtin');
  const effectiveProvider: ProviderType = inferredAdvancedMode ? enforced.provider : 'builtin';

  const incomingApiKey = (enforced.apiKey ?? '').trim();
  const apiKey = incomingApiKey || currentConfig?.apiKey || '';
  if (!apiKey) {
    return { error: 'API Key is required' };
  }

  const normalizedStyles = sanitizeStyles(enforced.styles);
  const normalizedSuggestionCount = normalizeSuggestionCount(enforced.suggestionCount);

  const enableFallback = enforced.enableFallback ?? false;
  const incomingFallbackApiKey = (enforced.fallbackApiKey ?? '').trim();
  const fallbackApiKey = enableFallback
    ? (incomingFallbackApiKey || currentConfig?.fallbackApiKey || '')
    : undefined;
  if (enableFallback && !fallbackApiKey) {
    return { error: 'Fallback API Key is required' };
  }

  const autoTrigger = enforced.autoTrigger === undefined ? (currentConfig?.autoTrigger ?? true) : Boolean(enforced.autoTrigger);
  const autoAgent = enforced.autoAgent === undefined ? (currentConfig?.autoAgent ?? false) : Boolean(enforced.autoAgent);
  const privacyAcknowledged = enforced.privacyAcknowledged === undefined
    ? (currentConfig?.privacyAcknowledged ?? false)
    : Boolean(enforced.privacyAcknowledged);

  const customSystemPrompt = typeof enforced.customSystemPrompt === 'string' ? enforced.customSystemPrompt.trim() : '';
  const customUserPrompt = typeof enforced.customUserPrompt === 'string' ? enforced.customUserPrompt.trim() : '';

  currentConfig = {
    ...enforced,
    provider: effectiveProvider,
    apiKey,
    advancedMode: inferredAdvancedMode,
    baseUrl: normalizeBaseUrl(enforced.baseUrl),
    allowInsecureHttp: enforced.allowInsecureHttp ?? false,
    allowPrivateHosts: enforced.allowPrivateHosts ?? false,
    model: normalizeModel(enforced.model),
    language: normalizeLanguage(enforced.language),
    autoTrigger,
    autoInGroups: Boolean(enforced.autoInGroups),
    autoAgent,
    customSystemPrompt: customSystemPrompt || undefined,
    customUserPrompt: customUserPrompt || undefined,
    redactPii: enforced.redactPii ?? true,
    anonymizeSenders: enforced.anonymizeSenders ?? true,
    contextMessageLimit: normalizeOptionalInt(enforced.contextMessageLimit, { min: 1, max: 50 }),
    maxCharsPerMessage: normalizeOptionalInt(enforced.maxCharsPerMessage, { min: 50, max: 4000 }),
    maxTotalChars: normalizeOptionalInt(enforced.maxTotalChars, { min: 200, max: 20_000 }),
    temperature: normalizeOptionalInt(enforced.temperature, { min: 0, max: 100 }) ?? (currentConfig?.temperature ?? 80),
    enableFallback,
    fallbackBaseUrl: enableFallback ? normalizeBaseUrl(enforced.fallbackBaseUrl) : undefined,
    fallbackAllowInsecureHttp: enableFallback ? (enforced.fallbackAllowInsecureHttp ?? false) : false,
    fallbackAllowPrivateHosts: enableFallback ? (enforced.fallbackAllowPrivateHosts ?? false) : false,
    fallbackModel: normalizeModel(enforced.fallbackModel),
    fallbackApiKey,
    styles: normalizedStyles,
    suggestionCount: normalizedSuggestionCount,
    enableMemory: enforced.enableMemory ?? false,
    persistApiKey: enforced.persistApiKey ?? false,
    privacyAcknowledged,
  };

  // 保存到 storage
  const baseConfigToPersist = {
    advancedMode: currentConfig.advancedMode ?? false,
    provider: currentConfig.provider,
    ...(currentConfig.baseUrl ? { baseUrl: currentConfig.baseUrl } : {}),
    allowInsecureHttp: currentConfig.allowInsecureHttp ?? false,
    allowPrivateHosts: currentConfig.allowPrivateHosts ?? false,
    model: currentConfig.model,
    styles: currentConfig.styles,
    language: currentConfig.language ?? 'auto',
    autoTrigger: currentConfig.autoTrigger ?? true,
    autoInGroups: currentConfig.autoInGroups ?? false,
    autoAgent: currentConfig.autoAgent ?? false,
    customSystemPrompt: currentConfig.customSystemPrompt,
    customUserPrompt: currentConfig.customUserPrompt,
    privacyAcknowledged: currentConfig.privacyAcknowledged ?? false,
    redactPii: currentConfig.redactPii ?? true,
    anonymizeSenders: currentConfig.anonymizeSenders ?? true,
    contextMessageLimit: currentConfig.contextMessageLimit,
    maxCharsPerMessage: currentConfig.maxCharsPerMessage,
    maxTotalChars: currentConfig.maxTotalChars,
    temperature: currentConfig.temperature ?? 80,
    fallbackProvider: currentConfig.fallbackProvider,
    ...(currentConfig.fallbackBaseUrl ? { fallbackBaseUrl: currentConfig.fallbackBaseUrl } : {}),
    fallbackAllowInsecureHttp: currentConfig.fallbackAllowInsecureHttp ?? false,
    fallbackAllowPrivateHosts: currentConfig.fallbackAllowPrivateHosts ?? false,
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
    await storageLocalSet(toSet);
    const keysToRemove: string[] = [];
    if (!currentConfig.baseUrl) keysToRemove.push('baseUrl');
    if (!currentConfig.customSystemPrompt) keysToRemove.push('customSystemPrompt');
    if (!currentConfig.customUserPrompt) keysToRemove.push('customUserPrompt');
    if (!currentConfig.fallbackBaseUrl) keysToRemove.push('fallbackBaseUrl');
    if (!(currentConfig.enableFallback && currentConfig.fallbackApiKey)) {
      keysToRemove.push('fallbackApiKey');
    }
    if (keysToRemove.length) {
      await storageLocalRemove(keysToRemove);
    }
    await clearSessionKeys();
  } else {
    await storageLocalSet(baseConfigToPersist);
    const keysToRemove: string[] = ['apiKey', 'fallbackApiKey'];
    if (!currentConfig.baseUrl) keysToRemove.push('baseUrl');
    if (!currentConfig.customSystemPrompt) keysToRemove.push('customSystemPrompt');
    if (!currentConfig.customUserPrompt) keysToRemove.push('customUserPrompt');
    if (!currentConfig.fallbackBaseUrl) keysToRemove.push('fallbackBaseUrl');
    if (keysToRemove.length) {
      await storageLocalRemove(keysToRemove);
    }
    try {
      await setSessionKeys(currentConfig.apiKey, currentConfig.enableFallback ? currentConfig.fallbackApiKey : undefined);
    } catch (err) {
      debugWarn(
        '[Social Copilot] Failed to persist session keys (service worker may lose key on restart):',
        sanitizeErrorForDiagnostics(err)
      );
    }
  }

  const managerConfig = buildManagerConfig(currentConfig);
  fallbackModeActive = false;
  const promptRegistry = buildPromptHookRegistry(currentConfig);
  llmManager = new LLMManager(
    managerConfig,
    {
      onFallback: handleFallbackEvent,
      onRecovery: handleRecoveryEvent,
      onAllFailed: handleAllFailedEvent,
    },
    promptRegistry
  );

  const profileLLM: LLMProvider = {
    get name() {
      return llmManager?.getActiveProvider() || currentConfig?.provider || 'deepseek';
    },
    generateReply: (input: LLMInput) => {
      if (!llmManager) {
        throw new Error('LLM manager not initialized');
      }
      const sanitizedInput: LLMInput = {
        ...input,
        context: sanitizeOutboundContext(input.context, buildOutboundPrivacyOptions(currentConfig)),
      };
      return llmManager.generateReply(sanitizedInput);
    },
  };

  profileUpdater = new ProfileUpdater(profileLLM, 20);

  const fallbackLabel = managerConfig.fallback ? managerConfig.fallback.provider : 'disabled';
  debugLog(`[Social Copilot] Config updated: provider=${currentConfig.provider}, fallback=${fallbackLabel}`);
  return { success: true };
}

function buildManagerConfig(config: Config): LLMManagerConfig {
  const enforced = applyReleaseRestrictions(config);
  const inferredAdvancedMode = enforced.advancedMode ?? (enforced.provider !== 'builtin');
  const isBuiltin = !inferredAdvancedMode || enforced.provider === 'builtin';
  const fallbackEnabled = (enforced.enableFallback ?? false) && !!enforced.fallbackApiKey;
  return {
    primary: {
      provider: isBuiltin ? 'builtin' : enforced.provider,
      apiKey: enforced.apiKey,
      model: isBuiltin ? BUILTIN_MODEL : enforced.model,
      baseUrl: isBuiltin ? undefined : enforced.baseUrl,
      allowInsecureHttp: enforced.allowInsecureHttp ?? false,
      allowPrivateHosts: enforced.allowPrivateHosts ?? false,
    },
    fallback: fallbackEnabled
      ? {
          provider: enforced.fallbackProvider || enforced.provider,
          apiKey: enforced.fallbackApiKey as string,
          model: enforced.fallbackModel,
          baseUrl: enforced.fallbackBaseUrl,
          allowInsecureHttp: enforced.fallbackAllowInsecureHttp ?? false,
          allowPrivateHosts: enforced.fallbackAllowPrivateHosts ?? false,
        }
      : undefined,
  };
}

function buildPromptHookRegistry(config: Config): PromptHookRegistry | undefined {
  const customSystemPrompt = (config.customSystemPrompt ?? '').trim();
  const customUserPrompt = (config.customUserPrompt ?? '').trim();
  if (!customSystemPrompt && !customUserPrompt) return undefined;

  const registry = new PromptHookRegistry();
  registry.register({
    name: 'custom-prompts',
    transformSystemPrompt: (prompt, input) => {
      if (!customSystemPrompt) return prompt;
      const rendered = interpolateCustomPrompt(customSystemPrompt, input).trim();
      if (!rendered) return prompt;
      return `${prompt}\n\n【自定义系统提示】\n${rendered}`;
    },
    transformUserPrompt: (prompt, input) => {
      if (!customUserPrompt) return prompt;
      const rendered = interpolateCustomPrompt(customUserPrompt, input).trim();
      if (!rendered) return prompt;
      return `${prompt}\n\n【自定义用户提示】\n${rendered}`;
    },
  });
  return registry;
}

async function handleFallbackEvent(fromProvider: string, toProvider: string, error: Error) {
  debugWarn('[Social Copilot] Fallback triggered:', sanitizeErrorForDiagnostics(error));
  fallbackModeActive = true;
  pushDiagnostic({
    ts: Date.now(),
    type: 'FALLBACK',
    requestId: generateRequestId(),
    ok: true,
    details: { fromProvider, toProvider, message: redactSecrets(error.message) },
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
    error: { name: 'AllProvidersFailed', message: redactSecrets(errors.map((e) => e.message).join('; ')) },
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

  // Ensure config/LLM is available before touching local memory or calling providers.
  if (!llmManager || !currentConfig) {
    await loadConfig();
  }
  if (!llmManager || !currentConfig) {
    return { error: 'NO_API_KEY' }; // 使用错误码，方便前端处理
  }
  if (!currentConfig.privacyAcknowledged) {
    return { error: '首次使用请先在扩展设置中确认隐私告知。' };
  }

  const language = resolveLanguage(currentConfig.language, currentMessage, messages);

  // Persist minimal local message records for dedup/counting; only store redacted text when memory is enabled.
  const includeTextInLocalStore = Boolean(currentConfig?.enableMemory ?? false);
  for (const msg of messages) {
    await store.saveMessage(sanitizeMessageForLocalStore(msg, includeTextInLocalStore));
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
  profile = await maybeUpdateProfile(contactKey, profile, messages, messageCount, language);

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

  // 获取配置的风格（按偏好排序）
  const suggestionCount = normalizeSuggestionCount(currentConfig?.suggestionCount);
  const baseStyles = (currentConfig?.styles || DEFAULT_STYLES).slice(0, suggestionCount);
  const recommended = preferenceManager
    ? await preferenceManager.getRecommendedStyles(contactKey)
    : baseStyles;
  const styles = mergeStyles(baseStyles, recommended).slice(0, suggestionCount);

  // 构建输入
  const input: LLMInput = {
    context: buildSanitizedOutboundContext(contactKey, messages, currentMessage),
    profile,
    styles: styles as ReplyStyle[],
    language,
    temperature: (currentConfig.temperature ?? 80) / 100,
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
      void maybeUpdateMemory(contactKey, profile, messageCount, language);
    }

    return {
      candidates: output.candidates,
      model: output.model,
      latency: output.latency,
      provider: activeProvider,
      usingFallback: Boolean(fallbackModeActive && llmManager.hasFallback()),
    };
  } catch (error) {
    debugError('[Social Copilot] Failed to generate reply:', sanitizeErrorForDiagnostics(error));
    const message = toUserErrorMessage(error);

    if (currentConfig?.enableMemory ?? false) {
      void maybeUpdateMemory(contactKey, profile, messageCount, language);
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
    debugWarn('[Social Copilot] Failed to migrate profile key:', err);
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
  const message = redactSecrets(error instanceof Error ? error.message : String(error));

  // IndexedDB failures are self-healable via "Clear Data" but the raw errors are confusing to users.
  if (
    /Unsupported IndexedDB schema/i.test(message)
    || /IndexedDB migration failed/i.test(message)
    || /IndexedDB 迁移失败/.test(message)
    || /Database not initialized/i.test(message)
  ) {
    return '本地数据库初始化失败（可能是升级/回滚导致数据不兼容）。请在扩展设置页导出诊断后点击“清除数据”恢复。';
  }
  if (
    /IndexedDB open blocked/i.test(message)
    || /IndexedDB 打开被阻塞/.test(message)
    || (/blocked/i.test(message) && /IndexedDB/i.test(message))
    || (/被阻塞/.test(message) && /IndexedDB/i.test(message))
  ) {
    return '本地数据库被占用（可能有聊天站点标签页阻塞）。请先关闭 Telegram/WhatsApp/Slack 等站点标签页后重试，必要时在设置页执行“清除数据”。';
  }

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
  messageCount: number,
  language: 'zh' | 'en'
): Promise<ContactProfile> {
  if (!profileUpdater) return profile;

  const contactKeyStr = contactKeyToString(contactKey);
  const lastUpdate = lastProfileUpdateCount.get(contactKeyStr) || 0;

  if (profileUpdater.shouldUpdate(messageCount, lastUpdate)) {
    if (debugEnabled) {
      debugLog('[Social Copilot] Updating profile for:', profile.displayName);
    }

    try {
      const updates = await profileUpdater.extractProfileUpdates(recentMessages, profile, language);
      if (Object.keys(updates).length > 0) {
        await store.updateProfile(contactKey, updates);
        const refreshed = await store.getProfile(contactKey);
        if (refreshed) {
          profile = refreshed;
        }
        if (debugEnabled) {
          debugLog('[Social Copilot] Profile updated');
        }
      }
    } catch (error) {
      debugError('[Social Copilot] Failed to update profile:', sanitizeErrorForDiagnostics(error));
    } finally {
      await setLastProfileUpdateCount(contactKeyStr, messageCount);
    }
  }

  return profile;
}

async function maybeUpdateMemory(
  contactKey: ContactKey,
  profile: ContactProfile,
  messageCount: number,
  language: 'zh' | 'en'
): Promise<void> {
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
    const currentMessage = recentMessages[recentMessages.length - 1];
    const input: LLMInput = {
      task: 'memory_extraction',
      context: buildSanitizedOutboundContext(contactKey, recentMessages.slice(0, -1), currentMessage),
      profile,
      memorySummary: existing?.summary,
      styles: ['rational'],
      language,
      maxLength: 800,
    };

    const output = await llmManager.generateReply(input);
    const raw = output.candidates[0]?.text ?? '';

    const parsed = parseJsonObjectFromText(raw);

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
        contactKeySummary: summarizeContactKeyForDiagnostics(contactKey),
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
      details: { contactKeySummary: summarizeContactKeyForDiagnostics(contactKey) },
      error: sanitizeErrorForDiagnostics(err),
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
    debugWarn('[Social Copilot] Failed to persist memory update counts:', err);
  }
  return { success: true };
}

async function clearContactData(contactKey: ContactKey) {
  await store.deleteMessages(contactKey);
  await store.deleteProfile(contactKey);
  await store.deleteStylePreference(contactKey);
  await store.deleteContactMemorySummary(contactKey);

  // Best-effort: clear counters for all known key variants
  for (const keyStr of getContactKeyStrCandidates(contactKey)) {
    lastProfileUpdateCount.delete(keyStr);
    lastMemoryUpdateCount.delete(keyStr);
  }
  try {
    await persistProfileUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist profile update counts:', err);
  }
  try {
    await persistMemoryUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist memory update counts:', err);
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
    debugError('[Social Copilot] Failed to get contacts:', sanitizeErrorForDiagnostics(error));
    return { contacts: [] };
  }
}

async function getContactsWithPrefs() {
  try {
    if (!preferenceManager) {
      preferenceManager = new StylePreferenceManager(store);
    }
    const profiles = await store.getAllProfiles();
    const contacts = await Promise.all(
      profiles.map(async (profile) => {
        const [messageCount, memory, preference] = await Promise.all([
          store.getMessageCount(profile.key),
          store.getContactMemorySummary(profile.key),
          preferenceManager!.getPreference(profile.key),
        ]);
        return {
          displayName: profile.displayName,
          app: profile.key.app,
          messageCount,
          key: profile.key,
          memorySummary: memory?.summary ?? null,
          memoryUpdatedAt: memory?.updatedAt ?? null,
          preference: preference ?? null,
        };
      })
    );
    return { contacts };
  } catch (error) {
    debugError('[Social Copilot] Failed to get contacts with prefs:', sanitizeErrorForDiagnostics(error));
    return { contacts: [] };
  }
}

async function clearData() {
  await storageLocalClear();
  await clearSessionKeys();
  lastProfileUpdateCount.clear();
  lastMemoryUpdateCount.clear();
  memoryUpdateInFlight.clear();
  await clearPersistedDiagnostics();
  debugEnabled = false;
  try {
    await storageLocalRemove(PROFILE_UPDATE_COUNT_STORAGE_KEY);
  } catch (err) {
    debugWarn('[Social Copilot] Failed to clear profile update counts:', err);
  }
  try {
    await storageLocalRemove(MEMORY_UPDATE_COUNT_STORAGE_KEY);
  } catch (err) {
    debugWarn('[Social Copilot] Failed to clear memory update counts:', err);
  }
  llmManager = null;
  fallbackModeActive = false;
  profileUpdater = null;
  preferenceManager = null;
  currentConfig = null;
  storeReady = null;
  storeInitError = null;

  // 重新初始化存储（允许在迁移失败时恢复）
  try {
    await store.deleteDatabase();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    storeInitError = e;
    return { success: false, error: `无法删除本地数据库：${e.message}` };
  }

  try {
    await ensureStoreReady();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    storeInitError = e;
    return { success: false, error: `无法重新初始化本地数据库：${e.message}` };
  }

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

interface UserDataBackupV1 {
  schemaVersion: 1;
  exportedAt: string;
  extensionVersion: string;
  data: {
    profiles: ContactProfile[];
    stylePreferences: StylePreference[];
    contactMemories: ContactMemorySummary[];
    profileUpdateCounts: Record<string, number>;
    memoryUpdateCounts: Record<string, number>;
  };
}

function normalizeCountRecordKeys(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeContactKeyStr(key);
    const prev = out[normalized];
    out[normalized] = prev === undefined ? value : Math.max(prev, value);
  }
  return out;
}

async function exportUserData(): Promise<{ backup: UserDataBackupV1 }> {
  const profiles = await store.getAllProfiles();
  const stylePreferences = await store.getAllStylePreferences();
  const contactMemories = await store.getAllContactMemorySummaries();

  const profileUpdateCounts: Record<string, number> = {};
  for (const [key, value] of lastProfileUpdateCount.entries()) {
    if (Number.isFinite(value)) profileUpdateCounts[key] = value;
  }
  const memoryUpdateCounts: Record<string, number> = {};
  for (const [key, value] of lastMemoryUpdateCount.entries()) {
    if (Number.isFinite(value)) memoryUpdateCounts[key] = value;
  }

  return {
    backup: {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      extensionVersion: runtimeGetManifestVersion(),
      data: {
        profiles,
        stylePreferences,
        contactMemories,
        profileUpdateCounts,
        memoryUpdateCounts,
      },
    },
  };
}

async function importUserData(payload: unknown): Promise<{ success: boolean; error?: string; imported?: Record<string, number>; skipped?: Record<string, number> }> {
  // Validate payload using Zod schema
  const validationResult = UserDataBackupSchema.safeParse(payload);
  if (!validationResult.success) {
    const errorMessage = formatZodError(validationResult.error);
    return { success: false, error: `备份文件格式验证失败：${errorMessage}` };
  }

  const validatedData = validationResult.data;
  const profileUpdateCounts = normalizeCountRecordKeys(validatedData.data.profileUpdateCounts);
  const memoryUpdateCounts = normalizeCountRecordKeys(validatedData.data.memoryUpdateCounts);

  let importResult:
    | { imported: { profiles: number; stylePreferences: number; contactMemories: number }; skipped: Record<string, number> }
    | null = null;
  try {
    importResult = await store.importSnapshot({
      schemaVersion: 1,
      exportedAt: Date.now(),
      profiles: validatedData.data.profiles,
      stylePreferences: validatedData.data.stylePreferences,
      contactMemories: validatedData.data.contactMemories,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `导入失败：${message}` };
  }

  const profiles = importResult.imported.profiles;
  const stylePreferences = importResult.imported.stylePreferences;
  const contactMemories = importResult.imported.contactMemories;

  lastProfileUpdateCount.clear();
  for (const [k, v] of Object.entries(profileUpdateCounts)) {
    lastProfileUpdateCount.set(k, v);
  }
  try {
    await persistProfileUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist profile update counts:', err);
  }

  lastMemoryUpdateCount.clear();
  for (const [k, v] of Object.entries(memoryUpdateCounts)) {
    lastMemoryUpdateCount.set(k, v);
  }
  try {
    await persistMemoryUpdateCounts();
  } catch (err) {
    debugWarn('[Social Copilot] Failed to persist memory update counts:', err);
  }

  return {
    success: true,
    imported: { profiles, stylePreferences, contactMemories },
    skipped: importResult.skipped,
  };
}
