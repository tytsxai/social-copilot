// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { contactKeyToString } from '@social-copilot/core';
import { TelegramAdapter } from './telegram';
import { WhatsAppAdapter } from './whatsapp';
import { SlackAdapter } from './slack';
import { queryFirst, setEditableText } from './base';

function mockWindowLocation(url: string): () => void {
  const realLocation = window.location;
  const parsed = new URL(url);
  const mockLocation = {
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    hash: parsed.hash,
    search: parsed.search,
    href: parsed.href,
    origin: parsed.origin,
    protocol: parsed.protocol,
    host: parsed.host,
    port: parsed.port,
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => parsed.href,
  } as unknown as Location;

  Object.defineProperty(window, 'location', { value: mockLocation, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: mockLocation, configurable: true });

  return () => {
    Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: realLocation, configurable: true });
  };
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      data.delete(String(key));
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: window.sessionStorage, configurable: true });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = '';
  window.history.replaceState({}, '', '/');
});

describe('Platform adapters: isMatch() URL matching', () => {
  test('Telegram: matches web.telegram.org and detects version from pathname', () => {
    {
      const restore = mockWindowLocation('https://web.telegram.org/a/#@alice');
      document.body.innerHTML = `<div id="editable-message-text" contenteditable="true"></div>`;

      const adapter = new TelegramAdapter();
      expect(adapter.isMatch()).toBe(true);
      expect(adapter.fillInput('test')).toBe(true);
      expect(document.querySelector('#editable-message-text')?.textContent).toBe('test');
      restore();
    }

    {
      const restore = mockWindowLocation('https://web.telegram.org/k/#@alice');
      document.body.innerHTML = `<div class="input-message-input" contenteditable="true"></div>`;

      const adapter = new TelegramAdapter();
      expect(adapter.isMatch()).toBe(true);
      expect(adapter.fillInput('test')).toBe(true);
      expect(document.querySelector('.input-message-input')?.textContent).toBe('test');
      restore();
    }

    {
      const restore = mockWindowLocation('https://example.com/k/#@alice');
      const adapter = new TelegramAdapter();
      expect(adapter.isMatch()).toBe(false);
      restore();
    }
  });

  test('WhatsApp: matches web.whatsapp.com', () => {
    {
      const restore = mockWindowLocation('https://web.whatsapp.com/');
      expect(new WhatsAppAdapter().isMatch()).toBe(true);
      restore();
    }
    {
      const restore = mockWindowLocation('https://example.com/');
      expect(new WhatsAppAdapter().isMatch()).toBe(false);
      restore();
    }
  });

  test('Slack: matches app.slack.com', () => {
    {
      const restore = mockWindowLocation('https://app.slack.com/client/T123/C456');
      expect(new SlackAdapter().isMatch()).toBe(true);
      restore();
    }
    {
      const restore = mockWindowLocation('https://example.com/client/T123/C456');
      expect(new SlackAdapter().isMatch()).toBe(false);
      restore();
    }
  });
});

describe('Platform adapters (contract)', () => {
  test('fillInput returns false when input box is missing', () => {
    // Telegram
    document.body.innerHTML = `<div class="chat-info"><div class="peer-title">Alice</div></div>`;
    expect(new TelegramAdapter().fillInput('x')).toBe(false);

    // WhatsApp (legacy selectors)
    document.body.innerHTML = `
      <div id="main">
        <header><div title="Bob"></div></header>
        <footer></footer>
      </div>
    `;
    expect(new WhatsAppAdapter().fillInput('x')).toBe(false);

    // Slack
    window.history.replaceState({}, '', '/client/T123/C456');
    document.body.innerHTML = `<div data-qa="channel_name">general</div>`;
    expect(new SlackAdapter().fillInput('x')).toBe(false);
  });

  test('Telegram: stable contactKey + message ids + fillInput', () => {
    window.location.hash = '#@alice';
    document.body.innerHTML = `
      <div class="chat-info">
        <div class="peer-title">Alice</div>
        <div class="info"><div class="subtitle"></div></div>
      </div>
      <div class="bubbles-inner">
        <div class="message" data-mid="123">
          <div class="text-content">hi</div>
          <span class="time">12:34</span>
        </div>
        <div class="message is-out" data-mid="124">
          <div class="text-content">yo</div>
          <span class="time">12:35</span>
        </div>
      </div>
      <div class="input-message-input" contenteditable="true"></div>
    `;

    const adapter = new TelegramAdapter();
    const contactKey = adapter.extractContactKey();
    expect(contactKey).not.toBeNull();
    expect(contactKey!.app).toBe('telegram');
    expect(contactKey!.conversationId).toBe('@alice');
    expect(contactKey!.peerId).toBe('Alice');

    const keyStr = contactKeyToString(contactKey!);
    const messages = adapter.extractMessages(10);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(`${keyStr}::123`);
    expect(messages[1].id).toBe(`${keyStr}::124`);

    const ok = adapter.fillInput('test');
    expect(ok).toBe(true);
    expect(document.querySelector('.input-message-input')?.textContent).toBe('test');
  });

  test('WhatsApp: stable conversationId from JID + stable message ids + fillInput', () => {
    localStorage.setItem('last-wid', '"111@c.us"');
    document.body.innerHTML = `
      <div id="main">
        <header>
          <div title="Bob"></div>
          <span title="participants"></span>
        </header>
        <div class="copyable-area">
          <div role="application">
            <div data-id="false_222@g.us_ABC" class="message-in">
              <div class="copyable-text"><span class="selectable-text">hello</span></div>
              <div data-pre-plain-text="[12:34, 12/14/2025] Alice: "></div>
            </div>
          </div>
        </div>
        <footer><div contenteditable="true"></div></footer>
      </div>
    `;

    const adapter = new WhatsAppAdapter();
    adapter.getInputElement();
    expect(adapter.getRuntimeInfo?.()?.variant).toBe('legacy');
    const contactKey = adapter.extractContactKey();
    expect(contactKey).not.toBeNull();
    expect(contactKey!.app).toBe('whatsapp');
    expect(contactKey!.accountId).toBe('111@c.us');
    expect(contactKey!.conversationId).toBe('222@g.us');
    expect(contactKey!.isGroup).toBe(true);

    const keyStr = contactKeyToString(contactKey!);
    const messages = adapter.extractMessages(10);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(`${keyStr}::false_222@g.us_ABC`);

    const expectedTs = new Date();
    expectedTs.setFullYear(2025, 11, 14);
    expectedTs.setHours(12, 34, 0, 0);
    expect(messages[0].timestamp).toBe(expectedTs.getTime());

    const ok = adapter.fillInput('hello!');
    expect(ok).toBe(true);
    expect(document.querySelector('#main footer [contenteditable="true"]')?.textContent).toBe('hello!');
  });

  test('WhatsApp: selector variant fallback (testid) + fillInput', () => {
    localStorage.setItem('last-wid', '"111@c.us"');
    document.body.innerHTML = `
      <div id="main">
        <header>
          <div title="Bob"></div>
          <span title="participants"></span>
        </header>
        <div data-testid="conversation-panel-body">
          <div role="application">
            <div data-id="false_222@g.us_ABC" class="message-in">
              <div data-testid="msg-text"><span class="selectable-text">hello</span></div>
              <div data-pre-plain-text="[12:34, 12/14/2025] Alice: "></div>
            </div>
          </div>
        </div>
        <div data-testid="conversation-compose-box-input" contenteditable="true"></div>
      </div>
    `;

    const adapter = new WhatsAppAdapter();
    const contactKey = adapter.extractContactKey();
    expect(adapter.getRuntimeInfo?.()?.variant).toBe('testid');
    expect(contactKey).not.toBeNull();
    expect(contactKey!.conversationId).toBe('222@g.us');

    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommandSpy, configurable: true });

    const ok = adapter.fillInput('hello!');
    expect(ok).toBe(true);
    expect(execCommandSpy).not.toHaveBeenCalled();
    expect(document.querySelector('#main [data-testid="conversation-compose-box-input"]')?.textContent).toBe('hello!');
  });

  test('Slack: includes teamId accountId + stable message ids + fillInput', () => {
    window.history.replaceState({}, '', '/client/T123/C456');
    document.body.innerHTML = `
      <div data-qa="channel_name">general</div>
      <div class="c-virtual_list__scroll_container">
        <div data-qa="message_container" data-qa-message-id="m1" data-sender-id="U2">
          <span data-qa="message_sender_name">Bob</span>
          <div class="c-message__body">Hello</div>
          <span data-qa="message_time">12:34 PM</span>
        </div>
      </div>
      <div data-qa="message_input"><div class="ql-editor" contenteditable="true"></div></div>
    `;

    const adapter = new SlackAdapter();
    const contactKey = adapter.extractContactKey();
    expect(contactKey).not.toBeNull();
    expect(contactKey!.app).toBe('slack');
    expect(contactKey!.accountId).toBe('T123');
    expect(contactKey!.conversationId).toBe('C456');

    const keyStr = contactKeyToString(contactKey!);
    const messages = adapter.extractMessages(10);
    expect(adapter.getRuntimeInfo?.()?.variant).toBe('virtual_list');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(`${keyStr}::m1`);

    const ok = adapter.fillInput('ping');
    expect(ok).toBe(true);
    expect(document.querySelector('[data-qa="message_input"] .ql-editor')?.textContent).toBe('ping');
  });

  test('Slack: selector variant fallback (scroller) + fillInput', () => {
    window.history.replaceState({}, '', '/client/T123/C456');
    document.body.innerHTML = `
      <div data-qa="channel_name">general</div>
      <div class="p-message_pane__scroller">
        <div data-qa="message_container" data-qa-message-id="m1" data-sender-id="U2">
          <span data-qa="message_sender_name">Bob</span>
          <div class="c-message__body">Hello</div>
          <span data-qa="message_time">12:34 PM</span>
        </div>
      </div>
      <div data-qa="message_input"><div role="textbox" contenteditable="true"></div></div>
    `;

    const adapter = new SlackAdapter();
    adapter.extractMessages(1);
    expect(adapter.getRuntimeInfo?.()?.variant).toBe('scroller');
    const ok = adapter.fillInput('ping');
    expect(ok).toBe(true);
    expect(document.querySelector('[data-qa="message_input"] [role="textbox"]')?.textContent).toBe('ping');
  });

  test('Slack: getCurrentUserId reads from meta tag (outgoing detection)', () => {
    window.history.replaceState({}, '', '/client/T123/C456');
    document.head.innerHTML = `<meta name="user_id" content="U2" />`;
    document.body.innerHTML = `
      <div data-qa="channel_name">general</div>
      <div class="c-virtual_list__scroll_container">
        <div data-qa="message_container" data-sender-id="U2">
          <span data-qa="message_sender_name">Bob</span>
          <div class="c-message__body">Hello</div>
          <span data-qa="message_time">12:34 PM</span>
        </div>
      </div>
    `;

    const adapter = new SlackAdapter();
    const messages = adapter.extractMessages(10);
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe('outgoing');
    expect(messages[0].senderName).toBe('我');
  });

  test('Slack: getCurrentUserId reads from localStorage (outgoing detection)', () => {
    window.history.replaceState({}, '', '/client/T123/C456');
    localStorage.setItem('localConfig_v2', JSON.stringify({ user_id: 'U2' }));
    document.body.innerHTML = `
      <div data-qa="channel_name">general</div>
      <div class="c-virtual_list__scroll_container">
        <div data-qa="message_container" data-sender-id="U2">
          <span data-qa="message_sender_name">Bob</span>
          <div class="c-message__body">Hello</div>
          <span data-qa="message_time">12:34 PM</span>
        </div>
      </div>
    `;

    const adapter = new SlackAdapter();
    const messages = adapter.extractMessages(10);
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe('outgoing');
    expect(messages[0].senderName).toBe('我');
  });
});

describe('Platform adapters: MutationObserver error isolation', () => {
  test('Slack: callback throw does not break subsequent messages', async () => {
    const restore = mockWindowLocation('https://app.slack.com/client/T123/C456');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    document.body.innerHTML = `
      <div data-qa="channel_name">general</div>
      <div class="c-virtual_list__scroll_container" id="container"></div>
    `;

    const adapter = new SlackAdapter();
    const received: string[] = [];
    const dispose = adapter.onNewMessage((msg) => {
      if (msg.text === 'first') throw new Error('boom');
      received.push(msg.text);
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div data-qa="message_container" data-qa-message-id="m1">
        <div class="c-message__body">first</div>
        <span data-qa="message_time">12:34</span>
        <span data-qa="message_sender_name">Alice</span>
      </div>
      <div data-qa="message_container" data-qa-message-id="m2">
        <div class="c-message__body">second</div>
        <span data-qa="message_time">12:35</span>
        <span data-qa="message_sender_name">Alice</span>
      </div>
    `;
    document.querySelector('#container')!.appendChild(wrapper);

    await new Promise((r) => setTimeout(r, 0));

    expect(received).toEqual(['second']);
    expect(consoleError).toHaveBeenCalled();

    dispose();
    consoleError.mockRestore();
    restore();
  });

  test('Telegram: callback throw does not break subsequent messages', async () => {
    const restore = mockWindowLocation('https://web.telegram.org/k/#@alice');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    window.location.hash = '#@alice';
    document.body.innerHTML = `
      <div class="chat-info">
        <div class="peer-title">Alice</div>
        <div class="info"><div class="subtitle"></div></div>
      </div>
      <div class="bubbles-inner" id="container"></div>
    `;

    const adapter = new TelegramAdapter();
    const received: string[] = [];
    const dispose = adapter.onNewMessage((msg) => {
      if (msg.text === 'first') throw new Error('boom');
      received.push(msg.text);
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="message" data-mid="123">
        <div class="text-content">first</div>
        <span class="time">12:34</span>
      </div>
      <div class="message" data-mid="124">
        <div class="text-content">second</div>
        <span class="time">12:35</span>
      </div>
    `;
    document.querySelector('#container')!.appendChild(wrapper);

    await new Promise((r) => setTimeout(r, 0));

    expect(received).toEqual(['second']);
    expect(consoleError).toHaveBeenCalled();

    dispose();
    consoleError.mockRestore();
    restore();
  });

  test('WhatsApp: callback throw does not break subsequent messages', async () => {
    const restore = mockWindowLocation('https://web.whatsapp.com/');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    localStorage.setItem('last-wid', '"111@c.us"');
    document.body.innerHTML = `
      <div id="main">
        <header>
          <div title="Bob"></div>
          <span title="participants"></span>
        </header>
        <div class="copyable-area">
          <div role="application" id="container"></div>
        </div>
        <footer><div contenteditable="true"></div></footer>
      </div>
    `;

    const adapter = new WhatsAppAdapter();
    const received: string[] = [];
    const dispose = adapter.onNewMessage((msg) => {
      if (msg.text === 'first') throw new Error('boom');
      received.push(msg.text);
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div data-id="false_222@g.us_ABC" class="message-in">
        <div class="copyable-text"><span class="selectable-text">first</span></div>
        <div data-pre-plain-text="[12:34, 12/14/2025] Alice: "></div>
      </div>
      <div data-id="false_222@g.us_DEF" class="message-in">
        <div class="copyable-text"><span class="selectable-text">second</span></div>
        <div data-pre-plain-text="[12:35, 12/14/2025] Alice: "></div>
      </div>
    `;
    document.querySelector('#container')!.appendChild(wrapper);

    await new Promise((r) => setTimeout(r, 0));

    expect(received).toEqual(['second']);
    expect(consoleError).toHaveBeenCalled();

    dispose();
    consoleError.mockRestore();
    restore();
  });
});

describe('queryFirst()', () => {
  test('skips invalid selector and continues probing', () => {
    document.body.innerHTML = `<div class="ok"></div>`;

    expect(() => queryFirst(['div[', '.ok'])).not.toThrow();
    const found = queryFirst<HTMLElement>(['div[', '.ok']);
    expect(found?.selector).toBe('.ok');
    expect(found?.element).toBeInstanceOf(HTMLElement);
    expect(found?.element.classList.contains('ok')).toBe(true);
  });

  test('returns null when all selectors are invalid or missing', () => {
    document.body.innerHTML = `<div class="ok"></div>`;

    expect(() => queryFirst(['div[', 'span['])).not.toThrow();
    expect(queryFirst(['div[', 'span['])).toBeNull();
  });
});

describe('setEditableText()', () => {
  test('sets input/textarea value', () => {
    const input = document.createElement('input');
    input.value = 'old';
    expect(setEditableText(input, 'new')).toBe(true);
    expect(input.value).toBe('new');

    const textarea = document.createElement('textarea');
    textarea.value = 'a';
    expect(setEditableText(textarea, 'b')).toBe(true);
    expect(textarea.value).toBe('b');
  });

  test('inserts plain text into contenteditable via Selection/Range', () => {
    document.body.innerHTML = `<div id="ed" contenteditable="true"><span>old</span></div>`;
    const el = document.getElementById('ed')!;

    expect(setEditableText(el, '<b>hi</b>')).toBe(true);
    expect(el.textContent).toBe('<b>hi</b>');
    expect(el.querySelector('b')).toBeNull();
  });
});
