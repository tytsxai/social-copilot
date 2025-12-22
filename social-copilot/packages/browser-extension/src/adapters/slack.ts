import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { buildMessageId, dispatchInputLikeEvent, parseTimestampFromText, queryFirst, setEditableText } from './base';
import { debugError, debugLog } from '../utils/debug';

/**
 * Slack Web 适配器
 * https://app.slack.com/
 */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = 'slack' as const;

  private observer: MutationObserver | null = null;
  private isDisposed = false;
  private setupTimeoutId: number | null = null;
  private variant: 'virtual_list' | 'scroller' | 'fallback' = 'virtual_list';
  private selectorHints: Partial<Record<'chatContainer' | 'message' | 'inputBox', string>> = {};

  private isDev(): boolean {
    return (
      (typeof process !== 'undefined' &&
        typeof process.env !== 'undefined' &&
        process.env.NODE_ENV === 'development') ||
      (typeof process === 'undefined' && typeof location !== 'undefined' && location.hostname === 'localhost')
    );
  }

  private readonly selectors = {
    chatContainer: '.c-virtual_list__scroll_container, .p-message_pane__scroller',
    message: '[data-qa="message_container"]',
    messageText: '.c-message__body, .p-rich_text_section',
    senderName: '[data-qa="message_sender_name"]',
    chatTitle: '[data-qa="channel_name"], .p-view_header__channel_title',
    inputBox:
      '[data-qa="message_input"] .ql-editor, [data-qa="message_input"] [role="textbox"][contenteditable="true"], [data-qa="message_input"] [contenteditable="true"]',
    time: '[data-qa="message_time"]',
  };

  isMatch(): boolean {
    return window.location.hostname === 'app.slack.com';
  }

  private findChatContainer(): HTMLElement | null {
    const found = queryFirst<HTMLElement>(this.selectors.chatContainer);
    if (found) {
      this.selectorHints.chatContainer = found.selector;
      if (found.selector.includes('c-virtual_list__scroll_container')) {
        this.variant = 'virtual_list';
      } else if (found.selector.includes('p-message_pane__scroller')) {
        this.variant = 'scroller';
      }
      return found.element;
    }

    const messageEl = queryFirst<HTMLElement>(this.selectors.message);
    if (messageEl?.element.parentElement) {
      this.variant = 'fallback';
      this.selectorHints.chatContainer = 'fallback:message_parent';
      return messageEl.element.parentElement as HTMLElement;
    }
    return null;
  }

  private getCurrentUserId(): string | null {
    const metaId =
      document.querySelector<HTMLMetaElement>('meta[name="user_id"], meta[name="slack-user-id"], meta[name="userId"]')
        ?.getAttribute('content');
    if (metaId?.trim()) return metaId.trim();

    const userMenu = document.querySelector<HTMLElement>(
      '[data-qa="user_menu_button"], [data-qa="user_menu"], [data-qa="user_button"], [data-qa="profile_menu"]'
    );
    const domId =
      userMenu?.getAttribute('data-member-id') ||
      userMenu?.getAttribute('data-user-id') ||
      userMenu?.dataset.memberId ||
      userMenu?.dataset.userId;
    if (domId?.trim()) return domId.trim();

    try {
      const raw = localStorage.getItem('localConfig_v2') || localStorage.getItem('localConfig');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const fromStorage = typeof parsed.user_id === 'string'
          ? parsed.user_id
          : typeof parsed.userId === 'string'
            ? parsed.userId
            : typeof parsed.user === 'string'
              ? parsed.user
              : undefined;
        if (fromStorage?.trim()) return fromStorage.trim();
      }
    } catch {
      // ignore
    }

    const slack = window as unknown as {
      TS?: {
        boot_data?: { user_id?: string };
        model?: { user?: { id?: string } };
      };
    };
    return slack.TS?.boot_data?.user_id || slack.TS?.model?.user?.id || null;
  }

  extractContactKey(): ContactKey | null {
    const pathMatch = window.location.pathname.match(/\/client\/([^/]+)\/([^/]+)/);
    const teamId = pathMatch?.[1] || '';
    const channelId = pathMatch?.[2] || '';

    const titleEl = document.querySelector(this.selectors.chatTitle);
    const peerName = titleEl?.textContent?.trim() || 'Unknown';

    const isGroup = !channelId.startsWith('D');

    return {
      platform: 'web',
      app: 'slack',
      conversationId: channelId || peerName,
      accountId: teamId || undefined,
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
    const textEl = el.querySelector(this.selectors.messageText);
    const text = textEl?.textContent?.trim();
    if (!text) return null;

    const senderEl = el.querySelector(this.selectors.senderName);
    const senderName = senderEl?.textContent?.trim() || 'Unknown';

    const senderId = el.getAttribute('data-sender-id') || el.dataset.senderId || null;
    const currentUserId = this.getCurrentUserId();

    const isOutgoing = (senderId && currentUserId && senderId === currentUserId)
      || senderName === 'You'
      || senderName === '你';

    const timeEl = el.querySelector(this.selectors.time);
    const timeText = timeEl?.textContent?.trim() || '';

    const messageId = el.getAttribute('data-qa-message-id');

    return {
      id: buildMessageId({
        preferredId: messageId,
        contactKey,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        senderName: isOutgoing ? '我' : senderName,
        text,
        timeText,
      }),
      contactKey,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      senderName: isOutgoing ? '我' : senderName,
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

    // 使用纯文本插入，避免将模型输出作为 HTML 解析
    if (!setEditableText(input, text)) return false;

    dispatchInputLikeEvent(input, text);

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
                  debugError('[Social Copilot] Slack onNewMessage callback error:', error);
                }
              }
            }
          } catch (error) {
            debugError('[Social Copilot] Slack MutationObserver error:', error);
          }
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
      if (this.isDev()) {
        debugLog('[Social Copilot] Slack message observer started');
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

  private parseTime(timeText: string): number {
    return parseTimestampFromText(timeText);
  }

  getRuntimeInfo() {
    return {
      variant: this.variant,
      selectorHints: { ...this.selectorHints },
    };
  }
}
