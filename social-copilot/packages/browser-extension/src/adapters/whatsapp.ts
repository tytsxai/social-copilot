import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { buildMessageId, dispatchInputLikeEvent, parseTimestampFromText, queryFirst, setEditableText } from './base';
import { debugError, debugLog } from '../utils/debug';

/**
 * WhatsApp Web 适配器
 * https://web.whatsapp.com/
 */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const;

  private observer: MutationObserver | null = null;
  private isDisposed = false;
  private setupTimeoutId: number | null = null;

  private variant: 'legacy' | 'testid' = 'legacy';
  private selectorHints: Partial<Record<'chatContainer' | 'message' | 'inputBox', string>> = {};

  private isDev(): boolean {
    return (
      (typeof process !== 'undefined' &&
        typeof process.env !== 'undefined' &&
        process.env.NODE_ENV === 'development') ||
      (typeof process === 'undefined' && typeof location !== 'undefined' && location.hostname === 'localhost')
    );
  }

  private readonly selectorVariants: Record<
    'legacy' | 'testid',
    {
      chatContainer: string;
      message: string;
      messageOut: string;
      messageIn: string;
      messageText: string;
      senderName: string;
      chatTitle: string;
      chatSubtitle: string;
      inputBox: string;
      time: string;
    }
  > = {
    legacy: {
      chatContainer: '#main .copyable-area [role="application"]',
      message: '[data-id]',
      messageOut: '.message-out',
      messageIn: '.message-in',
      messageText: '.copyable-text [class*="selectable-text"]',
      senderName: '[data-pre-plain-text]',
      chatTitle: '#main header [title]',
      chatSubtitle: '#main header span[title]',
      inputBox: '#main footer [contenteditable="true"]',
      time: '[data-pre-plain-text]',
    },
    testid: {
      chatContainer: '#main [data-testid="conversation-panel-body"] [role="application"], #main [role="application"]',
      message: '[data-id], [data-testid="msg-container"]',
      messageOut: '.message-out',
      messageIn: '.message-in',
      messageText: '[data-testid="msg-text"], .copyable-text [class*="selectable-text"], [class*="selectable-text"]',
      senderName: '[data-pre-plain-text]',
      chatTitle: '#main header [title], header [title]',
      chatSubtitle: '#main header span[title], header span[title]',
      inputBox:
        '#main [data-testid="conversation-compose-box-input"][contenteditable="true"], #main [data-testid="conversation-compose-box-input"] [contenteditable="true"], #main footer [contenteditable="true"]',
      time: '[data-pre-plain-text]',
    },
  };

  isMatch(): boolean {
    return window.location.hostname === 'web.whatsapp.com';
  }

  private resolveVariant(): void {
    const current = queryFirst<HTMLElement>(this.selectorVariants[this.variant].inputBox);
    if (current) return;

    const order: Array<'legacy' | 'testid'> = ['legacy', 'testid'];
    for (const candidate of order) {
      const found = queryFirst<HTMLElement>(this.selectorVariants[candidate].inputBox);
      if (found) {
        this.variant = candidate;
        return;
      }
    }
  }

  private get selectors() {
    this.resolveVariant();
    return this.selectorVariants[this.variant];
  }

  private findChatContainer(): HTMLElement | null {
    const found = queryFirst<HTMLElement>(this.selectors.chatContainer);
    if (found) {
      this.selectorHints.chatContainer = found.selector;
      return found.element;
    }

    const main = document.querySelector('#main');
    const messageEl = queryFirst<HTMLElement>(this.selectors.message, main ?? document);
    if (messageEl) {
      const appRoot = messageEl.element.closest('[role="application"]') as HTMLElement | null;
      if (appRoot) {
        this.selectorHints.chatContainer = 'fallback:[role="application"]';
        return appRoot;
      }
      this.selectorHints.chatContainer = 'fallback:message_parent';
      return messageEl.element.parentElement as HTMLElement | null;
    }

    if (main) {
      this.selectorHints.chatContainer = '#main';
      return main as HTMLElement;
    }

    return null;
  }

  private extractChatJidFromDataId(dataId: string): { jid: string; isGroup: boolean } | null {
    if (!dataId) return null;
    const match = dataId.match(/(?:^|_)([0-9A-Za-z-]+@((?:c|g)\.us|s\.whatsapp\.net))(?:_|$)/);
    if (!match) return null;
    const jid = match[1];
    const domain = match[2];
    return { jid, isGroup: domain === 'g.us' };
  }

  private getConversationId(): { conversationId: string; isGroup: boolean } | null {
    const container = this.findChatContainer();
    const messageEl = (container ?? document).querySelector(this.selectors.message) as HTMLElement | null;
    const dataId = messageEl?.getAttribute('data-id') || '';
    const parsed = this.extractChatJidFromDataId(dataId);
    if (parsed) {
      return { conversationId: parsed.jid, isGroup: parsed.isGroup };
    }
    return null;
  }

  private getAccountId(): string | undefined {
    const candidates = ['last-wid', 'last_wid', 'lastWID', 'lastLoggedInUserId'];
    for (const key of candidates) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      // Sometimes stored as JSON string.
      let decoded: unknown = trimmed;
      if (trimmed.startsWith('"')) {
        try {
          decoded = JSON.parse(trimmed) as unknown;
        } catch {
          decoded = trimmed;
        }
      }
      const value = typeof decoded === 'string' ? decoded : String(decoded);
      const match = value.match(/([0-9A-Za-z-]+@(?:c\.us|s\.whatsapp\.net))/);
      if (match?.[1]) return match[1];
    }
    return undefined;
  }

  extractContactKey(): ContactKey | null {
    const titleEl = document.querySelector(this.selectors.chatTitle);
    const peerName = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || 'Unknown';

    const subtitleEl = document.querySelector(this.selectors.chatSubtitle);
    const subtitleText = subtitleEl?.getAttribute('title') || '';
    const conv = this.getConversationId();
    const isGroup = conv?.isGroup ?? (subtitleText.includes(',') || subtitleText.includes('participants'));
    const accountId = this.getAccountId();

    return {
      platform: 'web',
      app: 'whatsapp',
      accountId,
      conversationId: conv?.conversationId || peerName,
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
    const isOutgoing = el.classList.contains('message-out') || el.closest('.message-out') !== null;
    const isIncoming = el.classList.contains('message-in') || el.closest('.message-in') !== null;

    if (!isOutgoing && !isIncoming) return null;

    const textEl = el.querySelector(this.selectors.messageText);
    const text = textEl?.textContent?.trim();
    if (!text) return null;

    const prePlainText = el.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
    const match = prePlainText.match(/\[([^\]]+)\]\s*([^:]*)/);
    
    let senderName = isOutgoing ? '我' : contactKey.peerId;
    let timestamp = Date.now();

    if (match) {
      const timeStr = match[1];
      const name = match[2]?.trim();
      
      if (!isOutgoing && name) {
        senderName = name;
      }
      
      timestamp = parseTimestampFromText(timeStr);
    }

    const messageId = el.getAttribute('data-id');

    return {
      id: buildMessageId({
        preferredId: messageId,
        contactKey,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        senderName,
        text,
        timeText: prePlainText,
      }),
      contactKey,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      senderName,
      text,
      timestamp,
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

    if (!setEditableText(input, text) && input instanceof HTMLElement) {
      input.textContent = text;
    }

    dispatchInputLikeEvent(input, text);

    return true;
  }

  onNewMessage(callback: (message: Message) => void): () => void {
    this.isDisposed = false;
    
    const findContainer = (): HTMLElement | null => {
      return this.findChatContainer();
    };

    let retryCount = 0;
    const maxRetries = 30;

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
                  debugError('[Social Copilot] WhatsApp onNewMessage callback error:', error);
                }
              }
            }
          } catch (error) {
            debugError('[Social Copilot] WhatsApp MutationObserver error:', error);
          }
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
      if (this.isDev()) {
        debugLog('[Social Copilot] WhatsApp message observer started');
      }
    };

    setupObserver();

    return () => {
      this.isDisposed = true;
      
      if (this.setupTimeoutId !== null) {
        clearTimeout(this.setupTimeoutId);
        this.setupTimeoutId = null;
      }
      
      this.observer?.disconnect();
      this.observer = null;
    };
  }

  getRuntimeInfo() {
    return {
      variant: this.variant,
      selectorHints: { ...this.selectorHints },
    };
  }
}
