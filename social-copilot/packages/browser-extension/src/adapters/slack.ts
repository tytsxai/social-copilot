import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import { buildMessageId, parseTimestampFromText } from './base';

/**
 * Slack Web 适配器
 * https://app.slack.com/
 */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = 'slack' as const;

  private observer: MutationObserver | null = null;
  private isDisposed = false;
  private setupTimeoutId: number | null = null;

  private readonly selectors = {
    chatContainer: '.c-virtual_list__scroll_container',
    message: '[data-qa="message_container"]',
    messageText: '.c-message__body, .p-rich_text_section',
    senderName: '[data-qa="message_sender_name"]',
    chatTitle: '[data-qa="channel_name"], .p-view_header__channel_title',
    inputBox: '[data-qa="message_input"] .ql-editor, [data-qa="message_input"] [contenteditable="true"]',
    time: '[data-qa="message_time"]',
  };

  isMatch(): boolean {
    return window.location.hostname === 'app.slack.com';
  }

  private findChatContainer(): HTMLElement | null {
    return document.querySelector(this.selectors.chatContainer) as HTMLElement;
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

    if (input.classList.contains('ql-editor')) {
      // 使用纯文本插入，避免将模型输出作为 HTML 解析
      input.textContent = '';
      const inserted = typeof document.execCommand === 'function'
        ? document.execCommand('insertText', false, text)
        : false;
      if (!inserted) {
        input.textContent = text;
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
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
              const messageEls = node.matches(this.selectors.message)
                ? [node]
                : Array.from(node.querySelectorAll(this.selectors.message));

              if (messageEls.length === 0) continue;

              const contactKey = this.extractContactKey();
              if (!contactKey) continue;

              for (const messageEl of messageEls) {
                const message = this.parseMessageElement(messageEl as HTMLElement, contactKey);
                if (message) callback(message);
              }
            }
          }
        }
      });

      this.observer.observe(container, { childList: true, subtree: true });
      console.log('[Social Copilot] Slack message observer started');
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
}
