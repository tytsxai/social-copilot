import { describe, expect, it } from 'vitest';
import type { ConversationContext, Message } from '../types';
import { sanitizeOutboundContext } from './sanitize';

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
