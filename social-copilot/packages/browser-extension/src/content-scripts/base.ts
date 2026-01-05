import type { ContactKey, Message, ReplyCandidate, ThoughtCard, ThoughtType } from '@social-copilot/core';
import type { PlatformAdapter } from '../adapters/base';
import { CopilotUI } from '../ui/copilot-ui';
import { debugError, debugLog, debugWarn } from '../utils/debug';
import {
  addStorageOnChangedListener,
  removeStorageOnChangedListener,
  runtimeSendMessage,
  storageLocalGet,
  storageLocalSet,
} from '../utils/webext';

export type SupportedApp = 'telegram' | 'whatsapp' | 'slack';

const DEFAULT_SEND_MESSAGE_TIMEOUT_MS = 30_000;
const AUTO_FAILURE_WINDOW_MS = 2 * 60_000;
const AUTO_FAILURE_THRESHOLD = 3;
const AUTO_COOLDOWN_MS = 60_000;

const isDevMode = (): boolean => {
  return (
    (typeof process !== 'undefined' &&
      typeof process.env !== 'undefined' &&
      process.env.NODE_ENV === 'development') ||
    (typeof process === 'undefined' && typeof location !== 'undefined' && location.hostname === 'localhost')
  );
};

type SelectorMatch = { element: Element; selector: string; index: number };

export const findFirstSelector = (
  selectors: string[],
  root: ParentNode = document
): SelectorMatch | null => {
  for (let i = 0; i < selectors.length; i += 1) {
    const selector = selectors[i];
    const element = root.querySelector(selector);
    if (element) {
      return { element, selector, index: i };
    }
  }
  return null;
};

export const logSelectorFallback = (
  app: SupportedApp,
  purpose: string,
  selectors: string[],
  match: SelectorMatch | null
): void => {
  if (!isDevMode()) return;
  if (match) {
    if (match.index > 0) {
      debugWarn(`[Social Copilot] ${app} selector fallback for ${purpose}`, {
        selected: match.selector,
        index: match.index,
        candidates: selectors,
      });
    }
  } else {
    debugWarn(`[Social Copilot] ${app} selector missing for ${purpose}`, {
      candidates: selectors,
    });
  }
};

class SendMessageTimeoutError extends Error {
  readonly name = 'SendMessageTimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Background did not respond within ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

function sendMessageWithTimeout<TResponse = unknown>(
  // `chrome.runtime.sendMessage` has many overloads (extensionId, options, etc).
  // Content scripts in this project always use the 1-arg form: `sendMessage(message)`.
  message: unknown,
  timeoutMs: number = DEFAULT_SEND_MESSAGE_TIMEOUT_MS
): Promise<TResponse> {
  let timer: number | undefined;
  let settled = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new SendMessageTimeoutError(timeoutMs)), timeoutMs);
  });

  const sendPromise = runtimeSendMessage<TResponse>(message);
  const guardedSendPromise = new Promise<TResponse>((resolve, reject) => {
    sendPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      }
    );
  });

  return Promise.race([guardedSendPromise, timeoutPromise]).finally(() => {
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

export interface CopilotContentScriptOptions {
  app: SupportedApp;
  adapter: PlatformAdapter;
  /** Wait selectors; any match means chat is ready */
  waitForChatSelectors: string[];
  /** Optional navigation watcher. Return cleanup. */
  setupNavigationListener?: (onChange: () => void) => (() => void) | void;
  /** Localized message shown when adapter health fails */
  adapterBrokenMessage: string;
}

export class CopilotContentScript {
  private adapter: PlatformAdapter;
  private ui: CopilotUI;
  private options: CopilotContentScriptOptions;

  private unsubscribe: (() => void) | null = null;
  private navigationCleanup: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private storageChangeHandler: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;
  private windowErrorHandler: ((event: ErrorEvent) => void) | null = null;
  private unhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

  private lastMessageId: string | null = null;
  private currentContactKey: ContactKey | null = null;
  private lastUsingFallback = false;

  private autoInGroups = false;
  private autoTrigger = true;
  private autoAgent = false;
  private privacyAcknowledged = false;
  private contextMessageLimit = 10;
  private pendingPrivacyAckGenerate:
    | { thoughtDirection?: ThoughtType; skipThoughtAnalysis: boolean; source: 'manual' | 'auto' }
    | null = null;

  private isGenerating = false;
  private queuedGenerate:
    | { thoughtDirection?: ThoughtType; skipThoughtAnalysis: boolean; source: 'manual' | 'auto' }
    | null = null;
  private activeGenerateToken = 0;
  private inFlightGenerateToken: number | null = null;
  private inFlightEpoch: number | null = null;

  private isDestroyed = false;
  private conversationEpoch = 0;
  private incomingDebounceTimer: number | null = null;
  private pendingIncomingMessage: Message | null = null;
  private readonly incomingDebounceMs = 600;

  private consecutiveAdapterFailures = 0;
  private autoDisabled = false;
  private autoFailureCount = 0;
  private autoFailureWindowStart = 0;
  private autoCooldownUntil = 0;
  private autoRecoveryTimer: number | null = null;
  private readonly adapterFailureThreshold = 3;
  private readonly autoRecoveryDelayMs = 5000;

  private summarizePathnameKind(pathname: string): string {
    const path = (pathname ?? '').trim();
    if (!path || path === '/') return 'root';

    // Slack: /client/<teamId>/<conversationId>
    if (path.startsWith('/client/')) return 'slack_client';

    // Telegram Web variants often use /k/ or /a/ prefixes; conversation identity is usually in hash.
    if (path.startsWith('/k/')) return 'telegram_k';
    if (path.startsWith('/a/')) return 'telegram_a';

    // Keep only a short, safe prefix hint (no IDs).
    const seg = path.split('/').filter(Boolean)[0] ?? '';
    if (!seg) return 'other';
    const cleaned = seg.replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
    return cleaned ? `seg:${cleaned}` : 'other';
  }

  /**
   * Concurrency model (important for maintainability):
   *
   * - Content scripts cannot reliably keep long-lived state; Background can also be restarted by MV3.
   * - We treat each "conversation" as an epoch. When navigation/switch happens, `conversationEpoch++`.
   * - Generation is guarded by `isGenerating` + an increasing token. This prevents stale async results
   *   from updating UI after conversation changes, and avoids overlapping requests.
   * - We do not abort in-flight background requests (no AbortController wiring here), so we must rely
   *   on epoch/token checks before applying results.
   */
  constructor(options: CopilotContentScriptOptions) {
    this.options = options;
    this.adapter = options.adapter;
    this.ui = new CopilotUI({
      onSelect: (candidate) => this.handleSelect(candidate),
      onRefresh: () => this.handleRefresh(),
      onThoughtSelect: (thought) => this.handleThoughtSelect(thought),
      onPrivacyAcknowledge: () => this.handlePrivacyAcknowledge(),
      onOpenSettings: () => {
        void sendMessageWithTimeout({ type: 'OPEN_OPTIONS_PAGE' });
      },
    });
  }

  async init() {
    debugLog(`[Social Copilot] Initializing ${this.options.app} adapter...`);

    if (!this.adapter.isMatch()) {
      debugLog(`[Social Copilot] Not a ${this.options.app} page, skipping`);
      return;
    }

    this.setupGlobalErrorReporting();

    try {
      await this.waitForChat();
      if (this.isDestroyed) return;

      await this.loadLocalSettings();
      if (this.isDestroyed) return;

      this.ui.mount();
      this.reportAdapterHealth();

      this.unsubscribe = this.adapter.onNewMessage((msg) => {
        if (!this.isDestroyed) this.handleNewMessage(msg);
      });

      this.setupKeyboardShortcuts();

      if (this.options.setupNavigationListener) {
        const cleanup = this.options.setupNavigationListener(() => this.resetConversationState());
        this.navigationCleanup = typeof cleanup === 'function' ? cleanup : null;
      }

      window.addEventListener('beforeunload', () => this.destroy());

      debugLog(`[Social Copilot] ${this.options.app} adapter ready`);
    } catch (err) {
      this.reportContentScriptError(err, { phase: 'init' });
      // Best-effort: show a generic adapter-broken message so users aren't left in silence.
      try {
        this.ui.mount();
        this.ui.setError(this.options.adapterBrokenMessage);
        this.ui.show();
      } catch {
        // ignore
      }
    }
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    debugLog(`[Social Copilot] Destroying ${this.options.app} adapter...`);

    if (this.incomingDebounceTimer !== null) {
      clearTimeout(this.incomingDebounceTimer);
      this.incomingDebounceTimer = null;
    }
    this.pendingIncomingMessage = null;

    if (this.autoRecoveryTimer !== null) {
      clearTimeout(this.autoRecoveryTimer);
      this.autoRecoveryTimer = null;
    }

    // Cancel queued/in-flight state (best-effort; does not abort background request).
    this.queuedGenerate = null;
    this.pendingPrivacyAckGenerate = null;
    this.isGenerating = false;
    this.inFlightGenerateToken = null;
    this.inFlightEpoch = null;

    this.navigationCleanup?.();
    this.navigationCleanup = null;

    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    if (this.storageChangeHandler) {
      removeStorageOnChangedListener(this.storageChangeHandler);
      this.storageChangeHandler = null;
    }

    if (this.windowErrorHandler) {
      window.removeEventListener('error', this.windowErrorHandler);
      this.windowErrorHandler = null;
    }
    if (this.unhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
      this.unhandledRejectionHandler = null;
    }

    this.unsubscribe?.();
    this.unsubscribe = null;

    this.ui.unmount();
  }

  private isLikelyExtensionError(filename?: string, stack?: string): boolean {
    const file = typeof filename === 'string' ? filename : '';
    const s = typeof stack === 'string' ? stack : '';
    return (
      file.startsWith('chrome-extension://') ||
      file.startsWith('moz-extension://') ||
      s.includes('chrome-extension://') ||
      s.includes('moz-extension://')
    );
  }

  private reportContentScriptError(
    error: unknown,
    meta: { phase?: string; filename?: string; lineno?: number; colno?: number } = {}
  ) {
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      const message = (err.message || 'unknown').slice(0, 800);
      const stack = typeof err.stack === 'string' ? err.stack.slice(0, 4000) : undefined;
      if (!this.isLikelyExtensionError(meta.filename, stack)) return;

      void sendMessageWithTimeout({
        type: 'REPORT_CONTENT_SCRIPT_ERROR',
        payload: {
          app: this.options.app,
          host: location.host,
          pathnameKind: this.summarizePathnameKind(location.pathname),
          pathnameLen: (location.pathname ?? '').length,
          phase: meta.phase,
          filename: meta.filename,
          lineno: meta.lineno,
          colno: meta.colno,
          name: err.name,
          message,
          stack,
        },
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private setupGlobalErrorReporting() {
    if (this.windowErrorHandler || this.unhandledRejectionHandler) return;

    this.windowErrorHandler = (event: ErrorEvent) => {
      if (this.isDestroyed) return;
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      if (!this.isLikelyExtensionError(event.filename, stack)) return;
      this.reportContentScriptError(event.error ?? event.message, {
        phase: 'window_error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
      this.recordAdapterFailure();
    };

    this.unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      if (this.isDestroyed) return;
      const reason = event.reason;
      const stack = reason instanceof Error ? reason.stack : undefined;
      if (!this.isLikelyExtensionError(undefined, stack)) return;
      this.reportContentScriptError(reason, { phase: 'unhandledrejection' });
      this.recordAdapterFailure();
    };

    window.addEventListener('error', this.windowErrorHandler);
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
  }

  private resetConversationState() {
    this.conversationEpoch += 1;

    if (this.incomingDebounceTimer !== null) {
      clearTimeout(this.incomingDebounceTimer);
      this.incomingDebounceTimer = null;
    }
    this.pendingIncomingMessage = null;

    if (this.autoRecoveryTimer !== null) {
      clearTimeout(this.autoRecoveryTimer);
      this.autoRecoveryTimer = null;
    }
    this.consecutiveAdapterFailures = 0;
    this.autoDisabled = false;

    // Do not carry over any queued generation to the next conversation.
    // Also release the lock so the new conversation can generate immediately.
    this.queuedGenerate = null;
    this.pendingPrivacyAckGenerate = null;
    this.isGenerating = false;
    this.inFlightGenerateToken = null;
    this.inFlightEpoch = null;

    this.lastMessageId = null;
    this.currentContactKey = null;
    this.lastUsingFallback = false;
    this.ui.hide();
    this.ui.setThoughtCards([]);

    const epoch = this.conversationEpoch;
    window.setTimeout(() => {
      if (this.isDestroyed) return;
      if (epoch !== this.conversationEpoch) return;
      this.reportAdapterHealth();
    }, 500);
  }

  private reportAdapterHealth() {
    try {
      const input = this.adapter.getInputElement();
      const contactKey = this.adapter.extractContactKey();
      const runtimeInfo = this.adapter.getRuntimeInfo?.();
      const messages = this.adapter.extractMessages(1);
      const ok = Boolean(input && contactKey);
      const reason = !input ? 'no_input' : !contactKey ? 'no_contact' : 'ok';

      const summarizeConversationId = (key: ContactKey): string => {
        const id = key.conversationId || '';
        if (!id) return 'missing';
        if (id.includes('@g.us')) return 'wa_group_jid';
        if (id.includes('@c.us') || id.includes('@s.whatsapp.net')) return 'wa_dm_jid';
        if (id.startsWith('@')) return 'at_handle';
        if (/^-?\d+$/.test(id)) return 'numeric';
        if (/^[CDG][A-Z0-9]+$/.test(id)) return 'slack_like';
        return 'other';
      };

      void sendMessageWithTimeout({
        type: 'REPORT_ADAPTER_HEALTH',
        payload: {
          app: this.options.app,
          host: location.host,
          pathnameKind: this.summarizePathnameKind(location.pathname),
          pathnameLen: (location.pathname ?? '').length,
          ok,
          adapterVariant: runtimeInfo?.variant,
          adapterSelectorHints: runtimeInfo?.selectorHints,
          hasInput: Boolean(input),
          hasContactKey: Boolean(contactKey),
          messageCount: messages.length,
          reason,
          inputTag: input?.tagName,
          inputContentEditable: input?.getAttribute?.('contenteditable'),
          inputRole: input?.getAttribute?.('role'),
          contactKeySummary: contactKey
            ? {
                platform: contactKey.platform,
                app: contactKey.app,
                isGroup: contactKey.isGroup,
                hasAccountId: Boolean(contactKey.accountId),
                accountIdLen: (contactKey.accountId ?? '').length,
                conversationIdKind: summarizeConversationId(contactKey),
                conversationIdLen: (contactKey.conversationId ?? '').length,
                peerIdLen: (contactKey.peerId ?? '').length,
              }
            : null,
          lastMessageSummary: messages[0]
            ? {
                idLen: (messages[0].id ?? '').length,
                dir: messages[0].direction,
                senderLen: (messages[0].senderName ?? '').length,
                textLen: (messages[0].text ?? '').length,
              }
            : null,
        },
      }).catch(() => {});

      if (!ok) {
        this.ui.setError(this.options.adapterBrokenMessage);
        this.ui.show();
      }
    } catch {
      // Ignore
    }
  }

  private recordAdapterFailure() {
    this.consecutiveAdapterFailures += 1;
    if (this.consecutiveAdapterFailures < this.adapterFailureThreshold) return;

    this.autoDisabled = true;
    this.ui.setError(this.options.adapterBrokenMessage);
    this.ui.show();
    this.reportAdapterHealth();

    if (this.autoRecoveryTimer === null) {
      const epoch = this.conversationEpoch;
      this.autoRecoveryTimer = window.setTimeout(() => {
        this.autoRecoveryTimer = null;
        if (this.isDestroyed) return;
        if (epoch !== this.conversationEpoch) return;

        const input = this.adapter.getInputElement();
        const contactKey = this.adapter.extractContactKey();
        if (input && contactKey) {
          this.consecutiveAdapterFailures = 0;
          this.autoDisabled = false;
          this.ui.hide();
        }

        this.reportAdapterHealth();
      }, this.autoRecoveryDelayMs);
    }
  }

  private async waitForChat(): Promise<void> {
    return new Promise((resolve) => {
      const selectors = this.options.waitForChatSelectors;
      let attempts = 0;
      const maxAttempts = 60; // ~30s
      let loggedFallback = false;
      let loggedMissing = false;

      const check = () => {
        if (this.isDestroyed) {
          resolve();
          return;
        }

        attempts += 1;
        const match = findFirstSelector(selectors);
        if (match) {
          if (!loggedFallback && match.index > 0) {
            logSelectorFallback(this.options.app, 'wait_for_chat', selectors, match);
            loggedFallback = true;
          }
          resolve();
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(check, 500);
        } else {
          debugLog('[Social Copilot] Timeout waiting for chat container');
          if (!loggedMissing) {
            logSelectorFallback(this.options.app, 'wait_for_chat', selectors, null);
            loggedMissing = true;
          }
          resolve();
        }
      };

      check();
    });
  }

  private setupKeyboardShortcuts() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isDestroyed) return;

      // Alt+S 或 Ctrl+Shift+S 触发建议
      if ((e.altKey && e.key === 's') || (e.ctrlKey && e.shiftKey && e.key === 'S')) {
        e.preventDefault();
        void this.generateSuggestions();
      }

      // Escape 隐藏面板
      if (e.key === 'Escape') {
        this.ui.hide();
      }
    };

    document.addEventListener('keydown', this.keydownHandler);
  }

  private handleNewMessage(message: Message) {
    if (this.isDestroyed) return;
    if (message.direction !== 'incoming') return;
    if (message.id === this.lastMessageId) return;

    if (this.autoDisabled) {
      this.lastMessageId = message.id;
      return;
    }

    if (!this.autoTrigger) {
      this.lastMessageId = message.id;
      return;
    }

    if (this.isAutoCooldownActive()) {
      this.lastMessageId = message.id;
      return;
    }

    this.lastMessageId = message.id;
    this.pendingIncomingMessage = message;
    const epoch = this.conversationEpoch;

    if (this.incomingDebounceTimer !== null) {
      clearTimeout(this.incomingDebounceTimer);
    }

    this.incomingDebounceTimer = window.setTimeout(() => {
      this.incomingDebounceTimer = null;
      if (this.isDestroyed) return;
      if (epoch !== this.conversationEpoch) return;

      const latest = this.pendingIncomingMessage;
      this.pendingIncomingMessage = null;
      if (!latest) return;

      void this.analyzeAndGenerateSuggestions(latest, epoch);
    }, this.incomingDebounceMs);
  }

  private async analyzeAndGenerateSuggestions(currentMessage: Message, epoch: number) {
    if (this.isDestroyed) return;
    if (epoch !== this.conversationEpoch) return;
    if (this.isAutoCooldownActive()) return;
    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) {
      this.recordAdapterFailure();
      return;
    }
    if (contactKey.isGroup && !this.autoInGroups) {
      return;
    }
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(this.contextMessageLimit);
    if (!this.privacyAcknowledged) {
      await this.generateSuggestions(undefined, false, epoch, 'auto');
      return;
    }
    await this.updateThoughtCards(contactKey, messages, currentMessage, epoch);
    await this.generateSuggestions(undefined, true, epoch, 'auto');
  }

  private async loadLocalSettings(): Promise<void> {
    try {
      const result = await storageLocalGet([
        'autoInGroups',
        'autoTrigger',
        'autoAgent',
        'privacyAcknowledged',
        'contextMessageLimit',
      ]);
      this.autoInGroups = Boolean(result.autoInGroups);
      this.autoTrigger = result.autoTrigger === undefined ? true : Boolean(result.autoTrigger);
      this.autoAgent = Boolean(result.autoAgent);
      this.privacyAcknowledged = Boolean(result.privacyAcknowledged);
      this.contextMessageLimit = this.normalizeContextMessageLimit(result.contextMessageLimit);
    } catch {
      this.autoInGroups = false;
      this.autoTrigger = true;
      this.autoAgent = false;
      this.privacyAcknowledged = false;
      this.contextMessageLimit = 10;
    }

    this.storageChangeHandler = (changes, areaName) => {
      if (areaName !== 'local') return;

      const autoInGroupsChange = changes.autoInGroups;
      if (autoInGroupsChange) {
        this.autoInGroups = Boolean(autoInGroupsChange.newValue);
      }

      const autoTriggerChange = changes.autoTrigger;
      if (autoTriggerChange) {
        this.autoTrigger = autoTriggerChange.newValue === undefined ? true : Boolean(autoTriggerChange.newValue);
      }

      const autoAgentChange = changes.autoAgent;
      if (autoAgentChange) {
        this.autoAgent = Boolean(autoAgentChange.newValue);
      }

      const privacyChange = changes.privacyAcknowledged;
      if (privacyChange) {
        this.privacyAcknowledged = Boolean(privacyChange.newValue);
        if (this.privacyAcknowledged) {
          this.ui.clearPrivacyPrompt();
          const pending = this.pendingPrivacyAckGenerate;
          this.pendingPrivacyAckGenerate = null;
          if (pending && !this.isDestroyed) {
            void this.generateSuggestions(pending.thoughtDirection, pending.skipThoughtAnalysis, undefined, pending.source);
          }
        }
      }

      const contextLimitChange = changes.contextMessageLimit;
      if (contextLimitChange) {
        this.contextMessageLimit = this.normalizeContextMessageLimit(contextLimitChange.newValue);
      }
    };

    addStorageOnChangedListener(this.storageChangeHandler);
  }

  private normalizeContextMessageLimit(value: unknown): number {
    const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN;
    if (!Number.isFinite(n)) return 10;
    const i = Math.floor(n);
    if (i < 1) return 1;
    if (i > 50) return 50;
    return i;
  }

  private async handlePrivacyAcknowledge() {
    if (this.isDestroyed) return;
    const pending = this.pendingPrivacyAckGenerate;
    this.pendingPrivacyAckGenerate = null;

    try {
      await sendMessageWithTimeout({ type: 'ACK_PRIVACY' });
    } catch {
      // Fallback: best-effort persist flag locally (background may still reject if not synced).
      try {
        await storageLocalSet({ privacyAcknowledged: true });
      } catch {
        // ignore
      }
    }
    this.privacyAcknowledged = true;
    this.ui.clearPrivacyPrompt();
    if (pending) {
      void this.generateSuggestions(pending.thoughtDirection, pending.skipThoughtAnalysis, undefined, pending.source);
    }
  }

  private async updateThoughtCards(contactKey: ContactKey, messages: Message[], currentMessage: Message, epoch: number) {
    if (this.isDestroyed) return;
    if (epoch !== this.conversationEpoch) return;

    try {
      const analyzeResponse = await sendMessageWithTimeout<{ cards?: ThoughtCard[] }>({
        type: 'ANALYZE_THOUGHT',
        payload: {
          context: {
            contactKey,
            recentMessages: messages,
            currentMessage,
          },
        },
      });

      if (!this.isDestroyed && epoch === this.conversationEpoch && analyzeResponse?.cards) {
        this.ui.setThoughtCards(analyzeResponse.cards);
      }
    } catch (error) {
      if (!this.isDestroyed) {
        debugWarn('[Social Copilot] Failed to analyze thought:', error);
      }
    }
  }

  private async handleThoughtSelect(thought: ThoughtType | null) {
    if (this.isDestroyed) return;
    await this.generateSuggestions(thought ?? undefined, false, undefined, 'manual');
  }

  private updateProviderNotice(response: { provider?: unknown; model?: unknown; usingFallback?: unknown }) {
    const provider = typeof response.provider === 'string' ? response.provider : '';
    const model = typeof response.model === 'string' ? response.model : '';
    const usingFallback = Boolean(response.usingFallback);
    const label = provider ? (model ? `${provider}/${model}` : provider) : '';

    if (usingFallback && !this.lastUsingFallback && label) {
      this.ui.setNotification(`已切换至 ${label}`);
    }
    if (!usingFallback && this.lastUsingFallback && label) {
      this.ui.setNotification(`已恢复使用 ${label}`);
    }
    this.lastUsingFallback = usingFallback;
  }

  private pickCurrentMessage(messages: Message[]): Message {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].direction === 'incoming') {
        return messages[i];
      }
    }
    return messages[messages.length - 1];
  }

  private async generateSuggestions(
    thoughtDirection?: ThoughtType,
    skipThoughtAnalysis = false,
    epoch?: number,
    source: 'manual' | 'auto' = 'manual'
  ) {
    if (this.isDestroyed) return;
    const currentEpoch = epoch ?? this.conversationEpoch;
    if (currentEpoch !== this.conversationEpoch) return;

    if (!this.privacyAcknowledged) {
      this.pendingPrivacyAckGenerate = { thoughtDirection, skipThoughtAnalysis, source };
      this.ui.setPrivacyPrompt(
        '生成建议时会将必要的对话上下文发送到你选择的第三方模型服务（如 DeepSeek / OpenAI / Claude）。默认会脱敏与匿名化，你可以在扩展设置中调整。'
      );
      return;
    }

    if (this.isGenerating) {
      // Only queue within the same conversation epoch; cross-epoch generations should not be chained.
      if (this.inFlightEpoch === currentEpoch) {
        this.queuedGenerate = { thoughtDirection, skipThoughtAnalysis, source };
      }
      return;
    }

    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) {
      if (source === 'auto') {
        this.recordAdapterFailure();
        return;
      }

      if (!skipThoughtAnalysis) {
        this.ui.setError('无法识别当前聊天对象，请刷新页面或更新扩展。');
        this.ui.show();
      }
      return;
    }
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(this.contextMessageLimit);
    if (messages.length === 0) {
      if (source === 'auto') {
        this.recordAdapterFailure();
        return;
      }

      if (!skipThoughtAnalysis) {
        this.ui.setError('未能读取聊天消息，请刷新页面后重试。');
        this.ui.show();
      }
      return;
    }

    this.consecutiveAdapterFailures = 0;
    if (source === 'auto') this.autoDisabled = false;

    this.isGenerating = true;
    this.inFlightEpoch = currentEpoch;
    const token = (this.activeGenerateToken += 1);
    this.inFlightGenerateToken = token;
    this.ui.setLoading(true);
    this.ui.show();

    const currentMessage = this.pickCurrentMessage(messages);

    if (!skipThoughtAnalysis) {
      await this.updateThoughtCards(contactKey, messages, currentMessage, currentEpoch);
      if (this.isDestroyed) {
        this.isGenerating = false;
        return;
      }
    }

    const selectedThought = thoughtDirection ?? this.ui.getSelectedThought() ?? undefined;

    try {
      const response = await sendMessageWithTimeout<{
        error?: string;
        candidates?: ReplyCandidate[];
        provider?: unknown;
        model?: unknown;
        usingFallback?: unknown;
      }>({
        type: 'GENERATE_REPLY',
        payload: {
          contactKey,
          messages,
          currentMessage,
          thoughtDirection: selectedThought,
          source,
        },
      });

      if (this.isDestroyed) return;
      if (currentEpoch !== this.conversationEpoch) return;
      if (token !== this.inFlightGenerateToken) return;

      if (response?.error) {
        this.ui.setError(response.error);
        if (source === 'auto') this.recordAutoFailure();
      } else if (response?.candidates) {
        this.ui.setCandidates(response.candidates);
        this.updateProviderNotice(response);
        this.recordAutoSuccess();
        if (source === 'auto' && this.autoAgent) {
          void this.autoReply(response.candidates);
        }
      } else {
        this.ui.setError('未收到有效响应');
        if (source === 'auto') this.recordAutoFailure();
      }
    } catch (error) {
      if (!this.isDestroyed) {
        debugError('[Social Copilot] Failed to generate suggestions:', error);
        if (error instanceof SendMessageTimeoutError) {
          this.ui.setError('后台响应超时，请稍后重试');
        } else {
          this.ui.setError('生成建议失败');
        }
        if (source === 'auto') this.recordAutoFailure();
        this.recordAdapterFailure();
      }
    } finally {
      if (token === this.inFlightGenerateToken) {
        this.isGenerating = false;
        this.inFlightGenerateToken = null;
        this.inFlightEpoch = null;

        if (!this.isDestroyed && this.queuedGenerate && currentEpoch === this.conversationEpoch) {
          const queued = this.queuedGenerate;
          this.queuedGenerate = null;
          void this.generateSuggestions(queued.thoughtDirection, queued.skipThoughtAnalysis, undefined, queued.source);
        }
      }
    }
  }

  private async autoReply(candidates: ReplyCandidate[]) {
    if (this.isDestroyed) return;
    if (!this.currentContactKey) return;
    if (this.currentContactKey.isGroup) return;
    if (!candidates.length) return;

    const picked = candidates[0];
    const filled = this.adapter.fillInput(picked.text);
    if (!filled) return;

    const sent = this.trySendCurrentInput();
    if (sent) {
      this.ui.hide();
      return;
    }

    // If sending isn't supported, keep suggestions visible so the user can confirm manually.
    this.ui.setNotification('已自动填充输入框（未能自动发送，请手动确认发送）');
    this.ui.show();
    setTimeout(() => {
      if (this.isDestroyed) return;
      this.ui.clearNotification();
    }, 2500);
  }

  private trySendCurrentInput(): boolean {
    const input = this.adapter.getInputElement();
    if (!input) return false;
    input.focus();

    const eventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    };

    try {
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      return true;
    } catch {
      return false;
    }
  }

  private isAutoCooldownActive(): boolean {
    if (this.autoCooldownUntil === 0) return false;
    if (this.autoCooldownUntil <= Date.now()) {
      this.autoCooldownUntil = 0;
      this.reportAutoCooldown(false, 'timeout');
      return false;
    }
    return true;
  }

  private recordAutoFailure(): void {
    const now = Date.now();
    if (!this.autoFailureWindowStart || now - this.autoFailureWindowStart > AUTO_FAILURE_WINDOW_MS) {
      this.autoFailureWindowStart = now;
      this.autoFailureCount = 1;
      return;
    }

    this.autoFailureCount += 1;
    if (this.autoFailureCount < AUTO_FAILURE_THRESHOLD) return;

    this.autoCooldownUntil = now + AUTO_COOLDOWN_MS;
    this.reportAutoCooldown(true, 'threshold', this.autoFailureCount);
    this.autoFailureCount = 0;
    this.autoFailureWindowStart = 0;
  }

  private recordAutoSuccess(): void {
    const hadCooldown = this.autoCooldownUntil > 0;
    const hadFailures = this.autoFailureCount > 0 || this.autoFailureWindowStart > 0;
    this.autoFailureCount = 0;
    this.autoFailureWindowStart = 0;
    this.autoCooldownUntil = 0;
    if (hadCooldown || hadFailures) {
      this.reportAutoCooldown(false, 'success');
    }
  }

  private reportAutoCooldown(active: boolean, reason: 'threshold' | 'timeout' | 'success', failureCount = 0) {
    void sendMessageWithTimeout({
      type: 'REPORT_AUTO_COOLDOWN',
      payload: {
        app: this.options.app,
        host: location.host,
        pathnameKind: this.summarizePathnameKind(location.pathname),
        pathnameLen: (location.pathname ?? '').length,
        active,
        reason,
        failureCount,
        windowMs: AUTO_FAILURE_WINDOW_MS,
        cooldownMs: AUTO_COOLDOWN_MS,
        cooldownUntil: this.autoCooldownUntil || undefined,
      },
    }).catch(() => {});
  }

  private handleSelect(candidate: ReplyCandidate) {
    if (this.isDestroyed) return;

    if (this.currentContactKey) {
      void sendMessageWithTimeout<void>({
        type: 'RECORD_STYLE_SELECTION',
        contactKey: this.currentContactKey,
        style: candidate.style,
      }).catch(() => {});
    }

    const success = this.adapter.fillInput(candidate.text);
    if (success) {
      this.ui.hide();
      this.adapter.getInputElement()?.focus();
      return;
    }

    void this.copyToClipboard(candidate.text)
      .then(() => {
        if (this.isDestroyed) return;
        this.ui.setNotification('已复制到剪贴板，请手动粘贴');
        setTimeout(() => {
          if (this.isDestroyed) return;
          this.ui.clearNotification();
          this.ui.hide();
        }, 2000);
      })
      .catch((error) => {
        debugWarn('[Social Copilot] Clipboard copy failed:', error);
        if (this.isDestroyed) return;
        // Keep candidates visible so the user can manually select/copy from the panel.
        this.ui.setNotification('无法自动填充输入框，且复制失败；请从面板中手动复制粘贴。');
        this.ui.show();
      });
  }

  private handleRefresh() {
    void this.generateSuggestions();
  }

  private async copyToClipboard(text: string): Promise<void> {
    // Prefer the modern async clipboard API.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // fall through to legacy fallback
      }
    }

    // Fallback: use a temporary textarea + execCommand('copy').
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) {
      throw new Error('Clipboard copy failed');
    }
  }
}
