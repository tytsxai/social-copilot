import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { buildMessageId, dispatchInputLikeEvent, parseTimestampFromText, queryFirst, setEditableText } from './base';
import { debugError, debugLog } from '../utils/debug';

/**
 * Telegram Web 适配器
 * 支持两个版本：
 * - K 版本: https://web.telegram.org/k/
 * - A 版本: https://web.telegram.org/a/
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const;

  private observer: MutationObserver | null = null;
  private version: 'k' | 'a' = 'k';
  private isDisposed = false;
  private setupTimeoutId: number | null = null;
  private selectorHints: Partial<Record<'chatContainer' | 'message' | 'inputBox', string>> = {};

  private isDev(): boolean {
    return (
      (typeof process !== 'undefined' &&
        typeof process.env !== 'undefined' &&
        process.env.NODE_ENV === 'development') ||
      (typeof process === 'undefined' && typeof location !== 'undefined' && location.hostname === 'localhost')
    );
  }

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

  private findChatContainer(): HTMLElement | null {
    const found = queryFirst<HTMLElement>(this.selectors.chatContainer);
    if (found) {
      this.selectorHints.chatContainer = found.selector;
      return found.element;
    }
    return null;
  }

  private extractConversationId(): string | null {
    const hash = window.location.hash || '';

    // Common forms:
    // - #@username
    // - #-123456789
    const direct = hash.match(/^#(-?\d+|@[\w]+)/);
    if (direct?.[1]) return direct[1];

    // Forms like: #/im?p=@username or #/im?p=-123
    const param = hash.match(/[#&?]p=(@[\w]+|-?\d+)/);
    if (param?.[1]) return param[1];

    // Best-effort: first plausible identifier after '#'
    const any = hash.match(/#.*?(@[\w]+|-?\d+)/);
    if (any?.[1]) return any[1];

    return null;
  }

  private detectVersion(): void {
    const path = window.location.pathname;
    if (path.startsWith('/a')) {
      this.version = 'a';
    } else {
      this.version = 'k';
    }
    if (this.isDev()) {
      debugLog(`[Social Copilot] Detected Telegram Web version: ${this.version}`);
    }
  }

  extractContactKey(): ContactKey | null {
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
      conversationId: this.extractConversationId() || peerName,
      peerId: peerName,
      isGroup,
    };
  }

  extractMessages(limit: number): Message[] {
    const messages: Message[] = [];
    const contactKey = this.extractContactKey();
    if (!contactKey) return messages;

    this.selectorHints.message = this.selectors.message;

    const container = this.findChatContainer();
    const messageEls = (container ?? document).querySelectorAll(this.selectors.message);
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
      el.getAttribute('data-message-id');

    const timeEl = el.querySelector(this.selectors.time);
    const timeText = timeEl?.textContent?.trim() || '';

    return {
      id: buildMessageId({
        preferredId: messageId,
        contactKey,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        senderName,
        text,
        timeText,
      }),
      contactKey,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      senderName,
      text,
      timestamp: this.parseTime(timeText),
    };
  }

  getInputElement(): HTMLElement | null {
    const found = queryFirst<HTMLElement>(this.selectors.inputBox);
    if (found) {
      this.selectorHints.inputBox = found.selector;
      return found.element;
    }
    return null;
  }

  fillInput(text: string): boolean {
    const input = this.getInputElement();
    if (!input) return false;

    input.focus();

    const updated = setEditableText(input, text);
    if (!updated) return false;

    dispatchInputLikeEvent(input, text);

    return true;
  }

  onNewMessage(callback: (message: Message) => void): () => void {
    this.isDisposed = false;
    
    const findContainer = (): HTMLElement | null => {
      return this.findChatContainer();
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
          try {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof HTMLElement)) continue;

              const messageEls = node.matches(this.selectors.message)
                ? [node]
                : Array.from(node.querySelectorAll(this.selectors.message));

              if (messageEls.length === 0) continue;

              const contactKey = this.extractContactKey();
              if (!contactKey) continue;

              for (const messageEl of messageEls) {
                try {
                  const message = this.parseMessageElement(messageEl as HTMLElement, contactKey);
                  if (message) callback(message);
                } catch (error) {
                  debugError('[Social Copilot] Telegram onNewMessage callback error:', error);
                }
              }
            }
          } catch (error) {
            debugError('[Social Copilot] Telegram MutationObserver error:', error);
          }
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
      if (this.isDev()) {
        debugLog('[Social Copilot] Message observer started');
      }
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
    return parseTimestampFromText(timeText);
  }

  getRuntimeInfo() {
    return {
      variant: this.version,
      selectorHints: { ...this.selectorHints },
    };
  }
}
