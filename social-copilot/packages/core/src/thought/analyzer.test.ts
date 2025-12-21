import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, ThoughtAnalyzer } from './analyzer';
import { ThoughtAwarePromptBuilder } from './prompt-builder';
import { THOUGHT_CARDS, type ConversationContext, type ThoughtType } from '../types';

const baseContact = {
  platform: 'web' as const,
  app: 'telegram' as const,
  conversationId: 'conv',
  peerId: 'peer',
  isGroup: false,
};

function buildContext(text: string): ConversationContext {
  return {
    contactKey: baseContact,
    recentMessages: [
      {
        id: '1',
        contactKey: baseContact,
        direction: 'incoming',
        senderName: 'Alice',
        text,
        timestamp: Date.now(),
      },
    ],
    currentMessage: {
      id: '2',
      contactKey: baseContact,
      direction: 'incoming',
      senderName: 'Alice',
      text,
      timestamp: Date.now(),
    },
  };
}

describe('ThoughtAnalyzer', () => {
  it('returns default order when context is missing', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(undefined as unknown as ConversationContext);

    expect(result.recommended).toEqual(DEFAULT_CONFIG.defaultOrder);
    expect(result.confidence).toBe(0);
  });

  it('returns custom default order when context is missing', () => {
    const analyzer = new ThoughtAnalyzer({
      defaultOrder: ['humor', 'solution', 'empathy', 'neutral'],
    });
    const result = analyzer.analyze(undefined as unknown as ConversationContext);

    expect(result.recommended).toEqual(['humor', 'solution', 'empathy', 'neutral']);
    expect(result.confidence).toBe(0);
  });

  it('accepts partial config (defaultOrder only)', () => {
    const analyzer = new ThoughtAnalyzer({ defaultOrder: ['solution', 'neutral', 'empathy', 'humor'] });
    const result = analyzer.analyze(undefined as unknown as ConversationContext);

    expect(result.recommended).toEqual(['solution', 'neutral', 'empathy', 'humor']);
    expect(result.confidence).toBe(0);
  });

  it.each([
    ['empathy' as ThoughtType, '今天好累，好烦，压力有点大'],
    ['solution' as ThoughtType, '能不能帮我看看这个问题？'],
    ['humor' as ThoughtType, '哈哈哈，今天笑死我了'],
  ])('prioritizes %s cues when message matches keywords', (expected: ThoughtType, text: string) => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(buildContext(text));

    expect(result.recommended[0]).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('applies custom keywords and weights', () => {
    const analyzer = new ThoughtAnalyzer({
      keywords: { negative: ['foobar'] },
      weights: { negative: 10, neutralBase: 0 },
    });
    const result = analyzer.analyze(buildContext('FOOBAR...'));

    expect(result.recommended[0]).toBe('empathy');
    expect(result.reason).toContain('negative sentiment detected');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('falls back to neutral when no keywords match', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(buildContext('你好呀，今天天气不错'));

    expect(result.recommended[0]).toBe('neutral');
    expect(result.reason).toBe('No specific sentiment detected');
    expect(result.confidence).toBe(0);
  });
});

describe('ThoughtAwarePromptBuilder', () => {
  it('injects thought direction and hint when provided', () => {
    const builder = new ThoughtAwarePromptBuilder();
    const input = builder.buildInput(buildContext('今天好累'), undefined, ['casual'], 'empathy');

    expect(input.thoughtDirection).toBe('empathy');
    expect(input.thoughtHint).toBe(THOUGHT_CARDS.empathy.promptHint);
    expect(input.language).toBe('zh');
  });

  it('keeps input clean when no thought is selected', () => {
    const builder = new ThoughtAwarePromptBuilder();
    const input = builder.buildInput(buildContext('好久不见'), undefined, ['humorous']);

    expect(input.thoughtDirection).toBeUndefined();
    expect(input.thoughtHint).toBeUndefined();
    expect(input.styles).toEqual(['humorous']);
  });
});
