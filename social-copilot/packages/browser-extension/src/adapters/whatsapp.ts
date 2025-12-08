import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { generateMessageId } from './base';

/**
 * WhatsApp Web 适配器
 * https://web.whatsapp.com/
 */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const;

  private observer: MutationObserver | null = null;
  private isDisposed = false;
  private setupTimeoutId: number | null = null;

  private readonly selectors = {
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
  };

  isMatch(): boolean {
    return window.location.hostname === 'web.whatsapp.com';
  }

  extractContactKey(): ContactKey | null {
    const titleEl = document.querySelector(this.selectors.chatTitle);
    const peerName = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || 'Unknown';

    const subtitleEl = document.querySelector(this.selectors.chatSubtitle);
    const subtitleText = subtitleEl?.getAttribute('title') || '';
    const isGroup = subtitleText.includes(',') || subtitleText.includes('participants');

    return {
      platform: 'web',
      app: 'whatsapp',
      conversationId: peerName,
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
    const isOutgoing = el.classList.contains('message-out') || el.closest('.message-out') !== null;
    const isIncoming = el.classList.contains('message-in') || el.closest('.message-in') !== null;

    if (!isOutgoing && !isIncoming) return null;

    const textEl = el.querySelector(this.selectors.messageText);
    const text = textEl?.textContent?.trim();
    if (!text) return null;

    const prePlainText = el.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
    const match = prePlainText.match(/\[([^\]]+)\]\s*([^:]*)/);
    
    let senderName = '我';
    let timestamp = Date.now();

    if (match) {
      const timeStr = match[1];
      const name = match[2]?.trim();
      
      if (!isOutgoing && name) {
        senderName = name;
      }
      
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const now = new Date();
        now.setHours(parseInt(timeMatch[1], 10));
        now.setMinutes(parseInt(timeMatch[2], 10));
        timestamp = now.getTime();
      }
    }

    if (!isOutgoing) {
      senderName = senderName || contactKey.peerId;
    }

    const messageId = el.getAttribute('data-id') || generateMessageId();

    return {
      id: messageId,
      contactKey,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      senderName,
      text,
      timestamp,
    };
  }

  getInputElement(): HTMLElement | null {
    return document.querySelector(this.selectors.inputBox) as HTMLElement;
  }

  fillInput(text: string): boolean {
    const input = this.getInputElement();
    if (!input) return false;

    input.focus();
    document.execCommand('insertText', false, text);
    
    if (!input.textContent) {
      input.textContent = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }

    return true;
  }

  onNewMessage(callback: (message: Message) => void): () => void {
    this.isDisposed = false;
    
    const findContainer = (): HTMLElement | null => {
      return document.querySelector(this.selectors.chatContainer) as HTMLElement;
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
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              const messageEl = node.hasAttribute('data-id')
                ? node
                : node.querySelector('[data-id]');

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
      console.log('[Social Copilot] WhatsApp message observer started');
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
}
