import type { ContactKey, Message, ReplyCandidate, ThoughtCard, ThoughtType } from '@social-copilot/core';
import type { PlatformAdapter } from '../adapters/base';
import { CopilotUI } from '../ui/copilot-ui';

export type SupportedApp = 'telegram' | 'whatsapp' | 'slack';

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

  private lastMessageId: string | null = null;
  private currentContactKey: ContactKey | null = null;
  private lastUsingFallback = false;

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
  private autoRecoveryTimer: number | null = null;
  private readonly adapterFailureThreshold = 3;
  private readonly autoRecoveryDelayMs = 5000;

  constructor(options: CopilotContentScriptOptions) {
    this.options = options;
    this.adapter = options.adapter;
    this.ui = new CopilotUI({
      onSelect: (candidate) => this.handleSelect(candidate),
      onRefresh: () => this.handleRefresh(),
      onThoughtSelect: (thought) => this.handleThoughtSelect(thought),
    });
  }

  async init() {
    console.log(`[Social Copilot] Initializing ${this.options.app} adapter...`);

    if (!this.adapter.isMatch()) {
      console.log(`[Social Copilot] Not a ${this.options.app} page, skipping`);
      return;
    }

    await this.waitForChat();
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

    console.log(`[Social Copilot] ${this.options.app} adapter ready`);
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    console.log(`[Social Copilot] Destroying ${this.options.app} adapter...`);

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
    this.isGenerating = false;
    this.inFlightGenerateToken = null;
    this.inFlightEpoch = null;

    this.navigationCleanup?.();
    this.navigationCleanup = null;

    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    this.unsubscribe?.();
    this.unsubscribe = null;

    this.ui.unmount();
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

      void chrome.runtime.sendMessage({
        type: 'REPORT_ADAPTER_HEALTH',
        payload: {
          app: this.options.app,
          host: location.host,
          pathname: location.pathname,
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
      });

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

      const check = () => {
        if (this.isDestroyed) {
          resolve();
          return;
        }

        attempts += 1;
        for (const selector of selectors) {
          if (document.querySelector(selector)) {
            resolve();
            return;
          }
        }

        if (attempts < maxAttempts) {
          setTimeout(check, 500);
        } else {
          console.log('[Social Copilot] Timeout waiting for chat container');
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
    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) {
      this.recordAdapterFailure();
      return;
    }
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(10);
    await this.updateThoughtCards(contactKey, messages, currentMessage, epoch);
    await this.generateSuggestions(undefined, true, epoch, 'auto');
  }

  private async updateThoughtCards(contactKey: ContactKey, messages: Message[], currentMessage: Message, epoch: number) {
    if (this.isDestroyed) return;
    if (epoch !== this.conversationEpoch) return;

    try {
      const analyzeResponse = await chrome.runtime.sendMessage({
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
        this.ui.setThoughtCards(analyzeResponse.cards as ThoughtCard[]);
      }
    } catch (error) {
      if (!this.isDestroyed) {
        console.warn('[Social Copilot] Failed to analyze thought:', error);
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

    const messages = this.adapter.extractMessages(10);
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
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_REPLY',
        payload: {
          contactKey,
          messages,
          currentMessage,
          thoughtDirection: selectedThought,
        },
      });

      if (this.isDestroyed) return;
      if (currentEpoch !== this.conversationEpoch) return;
      if (token !== this.inFlightGenerateToken) return;

      if (response?.error) {
        this.ui.setError(response.error);
      } else if (response?.candidates) {
        this.ui.setCandidates(response.candidates);
        this.updateProviderNotice(response);
      } else {
        this.ui.setError('未收到有效响应');
      }
    } catch (error) {
      if (!this.isDestroyed) {
        console.error('[Social Copilot] Failed to generate suggestions:', error);
        this.ui.setError('生成建议失败');
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

  private handleSelect(candidate: ReplyCandidate) {
    if (this.isDestroyed) return;

    if (this.currentContactKey) {
      void chrome.runtime.sendMessage({
        type: 'RECORD_STYLE_SELECTION',
        contactKey: this.currentContactKey,
        style: candidate.style,
      });
    }

    const success = this.adapter.fillInput(candidate.text);
    if (success) {
      this.ui.hide();
      this.adapter.getInputElement()?.focus();
      return;
    }

    navigator.clipboard.writeText(candidate.text).then(() => {
      if (!this.isDestroyed) {
        this.ui.setError('已复制到剪贴板，请手动粘贴');
        setTimeout(() => {
          if (!this.isDestroyed) this.ui.hide();
        }, 2000);
      }
    });
  }

  private handleRefresh() {
    void this.generateSuggestions();
  }
}
