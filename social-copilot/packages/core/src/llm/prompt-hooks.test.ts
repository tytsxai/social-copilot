import { afterEach, describe, expect, it } from 'vitest';
import type { LLMInput } from '../types';
import { applySystemPromptHooks, applyUserPromptHooks, clearPromptHooks, registerPromptHook } from './prompt-hooks';

const input: LLMInput = {
  context: {
    contactKey: {
      platform: 'web',
      app: 'telegram',
      conversationId: 'c1',
      peerId: 'p1',
      isGroup: false,
    },
    recentMessages: [],
    currentMessage: {
      id: 'm1',
      contactKey: {
        platform: 'web',
        app: 'telegram',
        conversationId: 'c1',
        peerId: 'p1',
        isGroup: false,
      },
      direction: 'incoming',
      senderName: 'Alice',
      text: 'hi',
      timestamp: 0,
    },
  },
  styles: ['casual'],
  language: 'zh',
};

afterEach(() => {
  clearPromptHooks();
});

describe('prompt-hooks', () => {
  it('applies system/user transforms in order', () => {
    registerPromptHook({
      name: 'a',
      transformSystemPrompt: (p) => `${p}-A`,
      transformUserPrompt: (p) => `${p}-a`,
    });
    registerPromptHook({
      name: 'b',
      transformSystemPrompt: (p) => `${p}-B`,
      transformUserPrompt: (p) => `${p}-b`,
    });

    expect(applySystemPromptHooks('S', input)).toBe('S-A-B');
    expect(applyUserPromptHooks('U', input)).toBe('U-a-b');
  });
});

