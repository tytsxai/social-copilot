import { describe, it, expect } from 'vitest';
import { ThoughtAwarePromptBuilder } from './prompt-builder';
import type { ConversationContext, ContactProfile } from '../types';
import { THOUGHT_CARDS } from '../types';

const context: ConversationContext = {
  contactKey: {
    platform: 'web',
    app: 'telegram',
    conversationId: 'conv',
    peerId: 'peer',
    isGroup: false,
  },
  recentMessages: [],
  currentMessage: {
    id: 'msg_1',
    contactKey: {
      platform: 'web',
      app: 'telegram',
      conversationId: 'conv',
      peerId: 'peer',
      isGroup: false,
    },
    direction: 'incoming',
    senderName: 'Alice',
    text: 'Hello!',
    timestamp: Date.now(),
  },
};

const profile: ContactProfile = {
  key: context.contactKey,
  displayName: 'Alice',
  interests: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('ThoughtAwarePromptBuilder', () => {
  it('attaches thought direction and hint when provided', () => {
    const builder = new ThoughtAwarePromptBuilder();
    const input = builder.buildInput(context, profile, ['casual', 'humorous'], 'solution');

    expect(input.thoughtDirection).toBe('solution');
    expect(input.thoughtHint).toBe(THOUGHT_CARDS.solution.promptHint);
    expect(input.language).toBe('zh');
  });

  it('honors custom language option', () => {
    const builder = new ThoughtAwarePromptBuilder();
    const input = builder.buildInput(context, profile, ['formal'], 'humor', 'en');

    expect(input.language).toBe('en');
  });

  it('omits thought metadata when no selection is made', () => {
    const builder = new ThoughtAwarePromptBuilder();
    const input = builder.buildInput(context, profile, ['formal']);

    expect(input.thoughtDirection).toBeUndefined();
    expect(input.thoughtHint).toBeUndefined();
  });
});
