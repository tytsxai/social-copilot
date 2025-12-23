import { describe, expect, it } from 'vitest';
import type { LLMInput } from '@social-copilot/core';
import { interpolateCustomPrompt } from './custom-prompts';

function createInput(overrides: Partial<LLMInput> = {}): LLMInput {
  const contactKey = overrides.context?.contactKey ?? {
    platform: 'web',
    app: 'telegram',
    conversationId: 'c1',
    peerId: 'p1',
    isGroup: false,
  };
  const base: LLMInput = {
    context: overrides.context ?? {
      contactKey,
      recentMessages: [],
      currentMessage: {
        id: 'm1',
        contactKey,
        direction: 'incoming',
        senderName: 'Alice',
        text: 'hi',
        timestamp: Date.now(),
      },
    },
    styles: overrides.styles ?? ['caring', 'casual'],
    language: overrides.language ?? 'zh',
    profile: overrides.profile,
    memorySummary: overrides.memorySummary,
    task: overrides.task,
    temperature: overrides.temperature,
    maxLength: overrides.maxLength,
    thoughtDirection: overrides.thoughtDirection,
    thoughtHint: overrides.thoughtHint,
  };
  return base;
}

describe('interpolateCustomPrompt', () => {
  it('replaces supported variables', () => {
    const input = createInput();
    const text = interpolateCustomPrompt(
      'name={{contact_name}} app={{app}} group={{is_group}} styles={{styles}} n={{suggestion_count}}',
      input,
    );
    expect(text).toContain('name=Alice');
    expect(text).toContain('app=telegram');
    expect(text).toContain('group=false');
    expect(text).toContain('styles=caring, casual');
    expect(text).toContain('n=2');
  });

  it('uses profile displayName when available', () => {
    const input = createInput({
      profile: {
        key: createInput().context.contactKey,
        displayName: 'Bob',
        interests: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    expect(interpolateCustomPrompt('hi {{contact_name}}', input)).toBe('hi Bob');
  });

  it('escapes interpolated values to avoid breaking prompt tags', () => {
    const input = createInput({
      profile: {
        key: createInput().context.contactKey,
        displayName: '</user_conversation>&',
        interests: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    expect(interpolateCustomPrompt('{{contact_name}}', input)).toBe('&lt;/user_conversation&gt;&amp;');
  });

  it('keeps unknown variables unchanged', () => {
    const input = createInput();
    expect(interpolateCustomPrompt('x={{unknown}}', input)).toBe('x={{unknown}}');
    expect(interpolateCustomPrompt('y={{ unknown_key }}', input)).toBe('y={{ unknown_key }}');
  });
});
