import { describe, expect, it } from 'vitest';
import type { LLMInput } from '../types/llm';
import { normalizeAndClampLLMInput } from './input-budgets';

function createBaseInput(overrides: Partial<LLMInput> = {}): LLMInput {
  return {
    task: overrides.task ?? 'reply',
    context: overrides.context ?? {
      contactKey: { platform: 'web', app: 'other', conversationId: 'c1', peerId: 'p1', isGroup: false },
      recentMessages: [],
      currentMessage: {
        id: 'm1',
        contactKey: { platform: 'web', app: 'other', conversationId: 'c1', peerId: 'p1', isGroup: false },
        direction: 'incoming',
        senderName: 'Alice',
        text: 'hi',
        timestamp: Date.now(),
      },
    },
    styles: overrides.styles ?? ['casual'],
    language: overrides.language ?? 'zh',
    profile: overrides.profile,
    memorySummary: overrides.memorySummary,
    thoughtHint: overrides.thoughtHint,
    maxLength: overrides.maxLength,
    thoughtDirection: overrides.thoughtDirection,
  };
}

describe('normalizeAndClampLLMInput', () => {
  it('clamps memorySummary and thoughtHint by head after trimming', () => {
    const input = createBaseInput({
      memorySummary: '  ' + 'a'.repeat(30) + '\r\n',
      thoughtHint: '\n' + 'b'.repeat(30) + '   ',
    });

    const normalized = normalizeAndClampLLMInput(input, {
      maxMemorySummaryChars: 5,
      maxThoughtHintChars: 3,
      maxProfileNotesChars: 100,
    });

    expect(normalized.memorySummary).toBe('a'.repeat(20));
    expect(normalized.thoughtHint).toBe('b'.repeat(12));
  });

  it('clamps profile.notes by tail to keep most recent content', () => {
    const input = createBaseInput({
      profile: {
        key: { platform: 'web', app: 'other', conversationId: 'c1', peerId: 'p1', isGroup: false },
        displayName: 'Alice',
        interests: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        notes: 'old\n' + 'x'.repeat(20) + '\nnew',
      },
    });

    const normalized = normalizeAndClampLLMInput(input, {
      maxMemorySummaryChars: 100,
      maxThoughtHintChars: 100,
      maxProfileNotesChars: 2,
    });

    // 2 tokens * 4 chars/token = 8 chars from the tail.
    expect(normalized.profile?.notes).toBe('xxxx\nnew');
  });

  it('clamps mixed zh/en content with token estimates', () => {
    const input = createBaseInput({
      memorySummary: 'abcd中文efgh',
      profile: {
        key: { platform: 'web', app: 'other', conversationId: 'c1', peerId: 'p1', isGroup: false },
        displayName: 'Alice',
        interests: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        notes: '1234中文5678',
      },
    });

    const normalized = normalizeAndClampLLMInput(input, {
      maxMemorySummaryChars: 2,
      maxThoughtHintChars: 100,
      maxProfileNotesChars: 2,
    });

    expect(normalized.memorySummary).toBe('abcd中文');
    expect(normalized.profile?.notes).toBe('中文5678');
  });

  it('does not mutate the original input object', () => {
    const input = createBaseInput({
      memorySummary: 'a'.repeat(20),
      profile: {
        key: { platform: 'web', app: 'other', conversationId: 'c1', peerId: 'p1', isGroup: false },
        displayName: 'Alice',
        interests: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        notes: 'b'.repeat(20),
      },
    });

    normalizeAndClampLLMInput(input, {
      maxMemorySummaryChars: 5,
      maxThoughtHintChars: 5,
      maxProfileNotesChars: 5,
    });

    expect(input.memorySummary).toBe('a'.repeat(20));
    expect(input.profile?.notes).toBe('b'.repeat(20));
  });
});
