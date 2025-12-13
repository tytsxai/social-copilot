import { WhatsAppAdapter } from '../adapters/whatsapp';
import { CopilotUI } from '../ui/copilot-ui';
import type { ContactKey, Message, ReplyCandidate, ThoughtType, ThoughtCard } from '@social-copilot/core';

/**
 * WhatsApp Web Content Script 入口
 */
class WhatsAppContentScript {
  private adapter: WhatsAppAdapter;
  private ui: CopilotUI;
  private unsubscribe: (() => void) | null = null;
  private lastMessageId: string | null = null;
  private isGenerating = false;
  private queuedGenerate: { thoughtDirection?: ThoughtType; skipThoughtAnalysis: boolean } | null = null;
  private currentContactKey: ContactKey | null = null;
  private lastUsingFallback = false;
  
  // 用于清理的引用
  private navigationObserver: MutationObserver | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private isDestroyed = false;

  constructor() {
    this.adapter = new WhatsAppAdapter();
    this.ui = new CopilotUI({
      onSelect: (candidate) => this.handleSelect(candidate),
      onRefresh: () => this.handleRefresh(),
      onThoughtSelect: (thought) => this.handleThoughtSelect(thought),
    });
  }

  async init() {
    console.log('[Social Copilot] Initializing WhatsApp adapter...');

    if (!this.adapter.isMatch()) {
      console.log('[Social Copilot] Not a WhatsApp page, skipping');
      return;
    }

    await this.waitForChat();
    
    if (this.isDestroyed) return;
    
    this.ui.mount();
    this.reportAdapterHealth();
    this.unsubscribe = this.adapter.onNewMessage((msg) => {
      if (!this.isDestroyed) {
        this.handleNewMessage(msg);
      }
    });
    this.setupKeyboardShortcuts();
    this.setupNavigationListener();
    
    // 页面卸载时清理
    window.addEventListener('beforeunload', () => this.destroy());

    console.log('[Social Copilot] WhatsApp adapter ready');
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
          app: 'whatsapp',
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
        this.ui.setError('WhatsApp 页面结构可能已变化，建议刷新页面或更新扩展。');
        this.ui.show();
      }
    } catch {
      // Ignore
    }
  }

  private async waitForChat(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 60;
      
      const check = () => {
        if (this.isDestroyed) {
          resolve();
          return;
        }
        
        attempts++;
        if (document.querySelector('#main')) {
          resolve();
        } else if (attempts < maxAttempts) {
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
      
      if ((e.altKey && e.key === 's') || (e.ctrlKey && e.shiftKey && e.key === 'S')) {
        e.preventDefault();
        this.generateSuggestions();
      }
      if (e.key === 'Escape') {
        this.ui.hide();
      }
    };
    
    document.addEventListener('keydown', this.keydownHandler);
  }

  private setupNavigationListener() {
    const header = document.querySelector('#main header');
    if (!header) return;
    
    let currentTitle = header.querySelector('[title]')?.getAttribute('title') || '';

    this.navigationObserver = new MutationObserver(() => {
      if (this.isDestroyed) {
        this.navigationObserver?.disconnect();
        return;
      }
      
      const newTitle = header.querySelector('[title]')?.getAttribute('title') || '';
      if (newTitle && newTitle !== currentTitle) {
        currentTitle = newTitle;
        this.lastMessageId = null;
        this.currentContactKey = null;
        this.lastUsingFallback = false;
        this.ui.hide();
        this.ui.setThoughtCards([]);
      }
    });

    this.navigationObserver.observe(header, { subtree: true, attributes: true });
  }

  private handleNewMessage(message: Message) {
    if (this.isDestroyed) return;
    
    if (message.direction === 'incoming' && message.id !== this.lastMessageId) {
      this.lastMessageId = message.id;
      console.log('[Social Copilot] New incoming message');
      this.analyzeAndGenerateSuggestions(message);
    }
  }

  private async analyzeAndGenerateSuggestions(currentMessage: Message) {
    if (this.isDestroyed) return;

    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) return;

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
    
    // 重新生成带有思路方向的建议
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

    // 使用 UI 选中的思路方向（如果没有传入）
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
    } else {
      navigator.clipboard.writeText(candidate.text).then(() => {
        if (!this.isDestroyed) {
          this.ui.setError('已复制到剪贴板，请手动粘贴');
          setTimeout(() => {
            if (!this.isDestroyed) this.ui.hide();
          }, 2000);
        }
      });
    }
  }

  private handleRefresh() {
    this.generateSuggestions();
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    console.log('[Social Copilot] Destroying WhatsApp adapter...');
    
    // 清理 MutationObserver
    this.navigationObserver?.disconnect();
    this.navigationObserver = null;
    
    // 清理事件监听器
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    
    // 清理消息监听
    this.unsubscribe?.();
    this.unsubscribe = null;
    
    // 清理 UI
    this.ui.unmount();
  }
}

const script = new WhatsAppContentScript();
script.init().catch(console.error);
