import { SlackAdapter } from '../adapters/slack';
import { CopilotUI } from '../ui/copilot-ui';
import type { ContactKey, Message, ReplyCandidate, ThoughtType, ThoughtCard } from '@social-copilot/core';

/**
 * Slack Web Content Script 入口
 */
class SlackContentScript {
  private adapter: SlackAdapter;
  private ui: CopilotUI;
  private unsubscribe: (() => void) | null = null;
  private lastMessageId: string | null = null;
  private isGenerating = false;
  private currentContactKey: ContactKey | null = null;
  
  // 用于清理的引用
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private runtimeMessageHandler: ((message: unknown) => void) | null = null;
  private isDestroyed = false;

  constructor() {
    this.adapter = new SlackAdapter();
    this.ui = new CopilotUI({
      onSelect: (candidate) => this.handleSelect(candidate),
      onRefresh: () => this.handleRefresh(),
      onThoughtSelect: (thought) => this.handleThoughtSelect(thought),
    });
  }

  async init() {
    console.log('[Social Copilot] Initializing Slack adapter...');

    if (!this.adapter.isMatch()) {
      console.log('[Social Copilot] Not a Slack page, skipping');
      return;
    }

    await this.waitForChat();
    
    if (this.isDestroyed) return;
    
    this.ui.mount();
    this.runtimeMessageHandler = (message) => this.handleRuntimeMessage(message);
    chrome.runtime.onMessage.addListener(this.runtimeMessageHandler);
    this.unsubscribe = this.adapter.onNewMessage((msg) => {
      if (!this.isDestroyed) {
        this.handleNewMessage(msg);
      }
    });
    this.setupKeyboardShortcuts();
    
    // 页面卸载时清理
    window.addEventListener('beforeunload', () => this.destroy());

    console.log('[Social Copilot] Slack adapter ready');
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
        if (document.querySelector('.c-virtual_list__scroll_container')) {
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

  private handleNewMessage(message: Message) {
    if (this.isDestroyed) return;
    
    if (message.direction === 'incoming' && message.id !== this.lastMessageId) {
      this.lastMessageId = message.id;
      console.log('[Social Copilot] New incoming message:', message.text.slice(0, 50));
      this.analyzeAndGenerateSuggestions(message);
    }
  }

  private async analyzeAndGenerateSuggestions(currentMessage: Message) {
    if (this.isDestroyed) return;

    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) return;

    const messages = this.adapter.extractMessages(10);
    
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
      console.warn('[Social Copilot] Failed to analyze thought:', error);
    }

    this.generateSuggestions();
  }

  private async handleThoughtSelect(thought: ThoughtType | null) {
    if (this.isDestroyed) return;
    await this.generateSuggestions(thought ?? undefined);
  }

  private handleRuntimeMessage(message: unknown) {
    if (this.isDestroyed || !message || typeof message !== 'object') return;
    const payload = message as { type?: string; [key: string]: unknown };

    switch (payload.type) {
      case 'FALLBACK_NOTIFICATION': {
        const provider = (payload.toProvider as string) || (payload.provider as string) || '备用模型';
        this.ui.setNotification(`已切换至 ${provider}`);
        break;
      }
      case 'FALLBACK_RECOVERY': {
        const provider = (payload.provider as string) || '主模型';
        this.ui.setNotification(`已恢复使用 ${provider}`);
        break;
      }
      case 'LLM_ALL_FAILED': {
        const errors = payload.errors as string[] | undefined;
        if (Array.isArray(errors) && errors.length > 0) {
          this.ui.setError(`模型调用失败：${errors.join('; ')}`);
        }
        break;
      }
      default:
        break;
    }
  }

  private async generateSuggestions(thoughtDirection?: ThoughtType) {
    if (this.isDestroyed || this.isGenerating) return;

    const contactKey = this.adapter.extractContactKey();
    if (!contactKey) return;
    this.currentContactKey = contactKey;

    const messages = this.adapter.extractMessages(10);
    if (messages.length === 0) return;

    this.isGenerating = true;
    this.ui.setLoading(true);
    this.ui.show();

    const selectedThought = thoughtDirection ?? this.ui.getSelectedThought() ?? undefined;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_REPLY',
        payload: {
          contactKey,
          messages,
          currentMessage: messages[messages.length - 1],
          thoughtDirection: selectedThought,
        },
      });

      if (this.isDestroyed) return;

      if (response?.error) {
        this.ui.setError(response.error);
      } else if (response?.candidates) {
        this.ui.setCandidates(response.candidates);
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
    
    console.log('[Social Copilot] Destroying Slack adapter...');
    
    // 清理事件监听器
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    
    if (this.runtimeMessageHandler) {
      chrome.runtime.onMessage.removeListener(this.runtimeMessageHandler);
      this.runtimeMessageHandler = null;
    }

    // 清理消息监听
    this.unsubscribe?.();
    this.unsubscribe = null;
    
    // 清理 UI
    this.ui.unmount();
  }
}

const script = new SlackContentScript();
script.init().catch(console.error);
