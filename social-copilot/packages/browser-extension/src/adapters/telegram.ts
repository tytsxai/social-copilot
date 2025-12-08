import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { generateMessageId } from './base';

/**
 * Telegram Web 适配器
 * 支持两个版本：
 * - K 版本: https://web.telegram.org/k/
 * - A 版本: https://web.telegram.org/a/
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;

  private observer: MutationObserver | null = null;
  private version: 'k' | 'a' | null = null;
  private isDisposed = false;
  private setupTimeoutId: number | null = null;

  // K 版本选择器
  private readonly selectorsK = {
    chatContainer: '.bubbles-inner',
    message: '.message',
    messageOut: '.is-out',
    messageText: '.text-content, .message-content',
    senderName: '.peer-title',
    chatTitle: '.chat-info .peer-title, .top .peer-title',
    chatSubtitle: '.chat-info .info .subtitle, .top .info',
    inputBox: '.input-message-input',
    messageId: 'data-mid',
    time: '.time',
  };

  // A 版本选择器
  private readonly selectorsA = {
    chatContainer: '#message-list, .messages-container',
    message: '.Message',
    messageOut: '.own',
    messageText: '.text-content, .message-text',
    senderName: '.message-title, .sender-name',
    chatTitle: '.ChatInfo .title, .chat-title',
    chatSubtitle: '.ChatInfo .subtitle, .chat-subtitle',
    inputBox: '#editable-message-text, .composer-input',
    messageId: 'data-message-id',
    time: '.message-time, .time',
  };

  private get selectors() {
    return this.version === 'a' ? this.selectorsA : this.selectorsK;
  }

  isMatch(): boolean {
    const isMatch = window.location.hostname === 'web.telegram.org';
    if (isMatch) {
      this.detectVersion();
    }
    return isMatch;
  }

  private detectVersion(): void {
    const path = window.location.pathname;
    if (path.startsWith('/a')) {
      this.version = 'a';
    } else {
      this.version = 'k';
    }
    console.log(`[Social Copilot] Detected Telegram Web version: ${this.version}`);
  }

  extractContactKey(): ContactKey | null {
    const hash = window.location.hash;
    const match = hash.match(/#(-?\d+|@[\w]+)/);

    const titleEl = document.querySelector(this.selectors.chatTitle);
    const peerName = titleEl?.textContent?.trim() || 'Unknown';

    const subtitleEl = document.querySelector(this.selectors.chatSubtitle);
    const subtitleText = subtitleEl?.textContent?.toLowerCase() || '';
    const isGroup =
      subtitleText.includes('members') ||
      subtitleText.includes('成员') ||
      subtitleText.includes('subscribers') ||
      subtitleText.includes('订阅');

    return {
      platform: 'web',
      app: 'telegram',
      conversationId: match?.[1] || peerName,
      peerId: peerName,
      isGroup,
    };
  }

  extractMessages(limit: number): Message[] {
    const messages: Message[] = [];
    const contactKey = this.extractContactKey();
    if (!contactKey) return messages;

    const messageEls = document.querySelectorAll(this.selectors.message);
    const recentEls = Array.from(messageEls).slice(-limit);

    for (const el of recentEls) {
      const message = this.parseMessageElement(el as HTMLElement, contactKey);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  private parseMessageElement(el: HTMLElement, contactKey: ContactKey): Message | null {
    const isOutgoing =
      el.classList.contains('is-out') ||
      el.classList.contains('own') ||
      el.closest('.is-out') !== null;

    let text = '';
    for (const selector of this.selectors.messageText.split(', ')) {
      const textEl = el.querySelector(selector);
      if (textEl?.textContent?.trim()) {
        text = textEl.textContent.trim();
        break;
      }
    }

    if (!text) return null;

    let senderName = '我';
    if (!isOutgoing) {
      const senderEl = el.querySelector(this.selectors.senderName);
      senderName = senderEl?.textContent?.trim() || contactKey.peerId;
    }

    const messageId =
      el.getAttribute(this.selectors.messageId) ||
      el.getAttribute('data-mid') ||
      el.getAttribute('data-message-id') ||
      generateMessageId();

    const timeEl = el.querySelector(this.selectors.time);
    const timeText = timeEl?.textContent?.trim() || '';

    return {
      id: messageId,
      contactKey,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      senderName,
      text,
      timestamp: this.parseTime(timeText),
    };
  }

  getInputElement(): HTMLElement | null {
    for (const selector of this.selectors.inputBox.split(', ')) {
      const el = document.querySelector(selector) as HTMLElement;
      if (el) return el;
    }
    return null;
  }

  fillInput(text: string): boolean {
    const input = this.getInputElement();
    if (!input) return false;

    input.focus();

    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return true;
  }

  onNewMessage(callback: (message: Message) => void): () => void {
    this.isDisposed = false;
    
    const findContainer = (): HTMLElement | null => {
      for (const selector of this.selectors.chatContainer.split(', ')) {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) return el;
      }
      return null;
    };

    let retryCount = 0;
    const maxRetries = 30; // 最多重试 30 次（30 秒）

    const setupObserver = () => {
      if (this.isDisposed) return;
      
      const container = findContainer();
      if (!container) {
        retryCount++;
        if (retryCount < maxRetries) {
          this.setupTimeoutId = window.setTimeout(setupObserver, 1000);
        }
        return;
      }

      this.observer = new MutationObserver((mutations) => {
        if (this.isDisposed) return;
        
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              const messageEl = node.classList.contains('message') || node.classList.contains('Message')
                ? node
                : node.querySelector(this.selectors.message);

              if (messageEl) {
                const contactKey = this.extractContactKey();
                if (contactKey) {
                  const message = this.parseMessageElement(messageEl as HTMLElement, contactKey);
                  if (message) {
                    callback(message);
                  }
                }
              }
            }
          }
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
      console.log('[Social Copilot] Message observer started');
    };

    setupObserver();

    // 返回清理函数
    return () => {
      this.isDisposed = true;
      
      // 清理 timeout
      if (this.setupTimeoutId !== null) {
        clearTimeout(this.setupTimeoutId);
        this.setupTimeoutId = null;
      }
      
      // 清理 observer
      this.observer?.disconnect();
      this.observer = null;
    };
  }

  private parseTime(timeText: string): number {
    if (!timeText) return Date.now();

    const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const now = new Date();
      now.setHours(parseInt(timeMatch[1], 10));
      now.setMinutes(parseInt(timeMatch[2], 10));
      now.setSeconds(0);
      return now.getTime();
    }

    return Date.now();
  }
}
