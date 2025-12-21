import { describe, expect, it } from 'vitest';
import type { ConversationContext, Message } from '../types';
import { redactPii, sanitizeOutboundContext } from './sanitize';

function makeMessage(partial: Partial<Message>): Message {
  return {
    id: partial.id ?? 'm1',
    contactKey: partial.contactKey ?? { platform: 'web', app: 'telegram', peerId: 'p', conversationId: 'c', isGroup: false },
    direction: partial.direction ?? 'incoming',
    senderName: partial.senderName ?? 'Alice',
    text: partial.text ?? 'hello',
    timestamp: partial.timestamp ?? Date.now(),
    raw: partial.raw,
  };
}

describe('sanitizeOutboundContext', () => {
  it('redacts common PII and anonymizes sender names', () => {
    const ctx: ConversationContext = {
      contactKey: { platform: 'web', app: 'telegram', peerId: 'p', conversationId: 'c', isGroup: false },
      recentMessages: [
        makeMessage({ id: 'a', direction: 'incoming', senderName: 'Bob', text: 'email is bob@example.com' }),
        makeMessage({ id: 'b', direction: 'outgoing', senderName: 'Me', text: 'call me at 13800138000' }),
      ],
      currentMessage: makeMessage({ id: 'c', direction: 'incoming', senderName: 'Bob', text: 'see https://example.com/x' }),
    };

    const out = sanitizeOutboundContext(ctx, { maxRecentMessages: 10, redactPii: true, anonymizeSenderNames: true });
    const texts = [...out.recentMessages, out.currentMessage].map(m => m.text).join('\n');

    expect(texts).not.toContain('bob@example.com');
    expect(texts).toContain('[EMAIL]');
    expect(texts).toContain('[PHONE]');
    expect(texts).toContain('[URL]');

    expect(out.recentMessages[0].senderName).toBe('对方');
    expect(out.recentMessages[1].senderName).toBe('我');
  });

  it('caps message counts and strips raw fields', () => {
    const ctx: ConversationContext = {
      contactKey: { platform: 'web', app: 'telegram', peerId: 'p', conversationId: 'c', isGroup: false },
      recentMessages: [
        makeMessage({ id: '1', raw: { secret: 'x' } }),
        makeMessage({ id: '2', raw: { secret: 'y' } }),
        makeMessage({ id: '3', raw: { secret: 'z' } }),
      ],
      currentMessage: makeMessage({ id: '4', raw: { secret: 'w' } }),
    };

    const out = sanitizeOutboundContext(ctx, { maxRecentMessages: 2, redactPii: false, anonymizeSenderNames: false });
    expect(out.recentMessages).toHaveLength(2);
    expect(out.recentMessages[0].id).toBe('2');
    expect(out.recentMessages[1].id).toBe('3');
    expect((out.recentMessages[0] as Message).raw).toBeUndefined();
    expect((out.currentMessage as Message).raw).toBeUndefined();
  });
});

describe('redactPii', () => {
  it('redacts phone number at start of line', () => {
    expect(redactPii('123456')).toBe('[PHONE]');
  });

  it('redacts phone number after space and preserves the space', () => {
    expect(redactPii('call 123456 now')).toBe('call [PHONE] now');
  });

  it('redacts phone number after punctuation and preserves punctuation', () => {
    expect(redactPii('call:123456; ok')).toBe('call:[PHONE]; ok');
  });

  it('does not redact when preceded by a word character', () => {
    expect(redactPii('a123456')).toBe('a123456');
  });

  it('does not redact short digit runs', () => {
    expect(redactPii('code 12345 ok')).toBe('code 12345 ok');
  });

  it('redacts Chinese mobile numbers even without separators', () => {
    expect(redactPii('手机号：13800138000')).toBe('手机号：[PHONE]');
  });

  it('redacts international-style phone numbers with symbols', () => {
    expect(redactPii('Call +1 (415) 555-2671 now')).toBe('Call [PHONE] now');
  });

  it('redacts URLs but preserves trailing punctuation', () => {
    expect(redactPii('see https://example.com/x).')).toBe('see [URL]).');
  });

  it('redacts emails with plus tags and subdomains', () => {
    expect(redactPii('mail me at a.b+tag@sub.example.co.uk')).toBe('mail me at [EMAIL]');
  });
});

describe('sanitizeOutboundContext total budget', () => {
  it('trims oldest messages first and always keeps the current message', () => {
    const ctx: ConversationContext = {
      contactKey: { platform: 'web', app: 'telegram', peerId: 'p', conversationId: 'c', isGroup: false },
      recentMessages: [
        makeMessage({ id: 'old', text: 'a'.repeat(150), direction: 'incoming' }),
        makeMessage({ id: 'newer', text: 'b'.repeat(150), direction: 'incoming' }),
      ],
      currentMessage: makeMessage({ id: 'cur', text: 'c'.repeat(100), direction: 'incoming' }),
    };

    const out = sanitizeOutboundContext(ctx, {
      maxRecentMessages: 10,
      maxCharsPerMessage: 1000,
      maxTotalChars: 200,
      redactPii: false,
      anonymizeSenderNames: false,
    });

    expect(out.currentMessage.id).toBe('cur');
    expect(out.currentMessage.text).toBe('c'.repeat(100));
    expect(out.recentMessages).toHaveLength(1);
    expect(out.recentMessages[0].id).toBe('newer');
    expect(out.recentMessages[0].text).toBe('b'.repeat(100));
  });
});
