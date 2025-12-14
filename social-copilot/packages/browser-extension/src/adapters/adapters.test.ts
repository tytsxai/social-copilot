// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { contactKeyToString } from '@social-copilot/core';
import { TelegramAdapter } from './telegram';
import { WhatsAppAdapter } from './whatsapp';
import { SlackAdapter } from './slack';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = '';
  window.history.replaceState({}, '', '/');
});

describe('Platform adapters (contract)', () => {
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
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(`${keyStr}::m1`);

    const ok = adapter.fillInput('ping');
    expect(ok).toBe(true);
    expect(document.querySelector('[data-qa="message_input"] .ql-editor')?.textContent).toBe('ping');
  });
});
