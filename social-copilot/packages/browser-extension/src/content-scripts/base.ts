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
  private queuedGenerate: { thoughtDirection?: ThoughtType; skipThoughtAnalysis: boolean } | null = null;

  private isDestroyed = false;

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
    this.lastMessageId = null;
    this.currentContactKey = null;
    this.lastUsingFallback = false;
    this.ui.hide();
    this.ui.setThoughtCards([]);
  }

  private reportAdapterHealth() {
    try {
      const input = this.adapter.getInputElement();
      const contactKey = this.adapter.extractContactKey();
      const messages = this.adapter.extractMessages(1);
      const ok = Boolean(input && contactKey);
      const reason = !input ? 'no_input' : !contactKey ? 'no_contact' : 'ok';

      void chrome.runtime.sendMessage({
        type: 'REPORT_ADAPTER_HEALTH',
        payload: {
          app: this.options.app,
          host: location.host,
          pathname: location.pathname,
          ok,
          hasInput: Boolean(input),
          hasContactKey: Boolean(contactKey),
          messageCount: messages.length,
          reason,
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
    if (message.direction === 'incoming' && message.id !== this.lastMessageId) {
      this.lastMessageId = message.id;
      void this.analyzeAndGenerateSuggestions(message);
    }
  }

  private async analyzeAndGenerateSuggestions(currentMessage: Message) {
    if (this.isDestroyed) return;
    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) return;
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(10);
    await this.updateThoughtCards(contactKey, messages, currentMessage);
    await this.generateSuggestions(undefined, true);
  }

  private async updateThoughtCards(contactKey: ContactKey, messages: Message[], currentMessage: Message) {
    if (this.isDestroyed) return;

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

      if (!this.isDestroyed && analyzeResponse?.cards) {
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
    await this.generateSuggestions(thought ?? undefined);
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

  private async generateSuggestions(thoughtDirection?: ThoughtType, skipThoughtAnalysis = false) {
    if (this.isDestroyed) return;

    if (this.isGenerating) {
      this.queuedGenerate = { thoughtDirection, skipThoughtAnalysis };
      return;
    }

    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) {
      if (!skipThoughtAnalysis) {
        this.ui.setError('无法识别当前聊天对象，请刷新页面或更新扩展。');
        this.ui.show();
      }
      return;
    }
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(10);
    if (messages.length === 0) {
      if (!skipThoughtAnalysis) {
        this.ui.setError('未能读取聊天消息，请刷新页面后重试。');
        this.ui.show();
      }
      return;
    }

    this.isGenerating = true;
    this.ui.setLoading(true);
    this.ui.show();

    const currentMessage = this.pickCurrentMessage(messages);

    if (!skipThoughtAnalysis) {
      await this.updateThoughtCards(contactKey, messages, currentMessage);
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
      this.isGenerating = false;
      if (!this.isDestroyed && this.queuedGenerate) {
        const queued = this.queuedGenerate;
        this.queuedGenerate = null;
        void this.generateSuggestions(queued.thoughtDirection, queued.skipThoughtAnalysis);
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

