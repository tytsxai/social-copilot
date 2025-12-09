import { describe, it, expect } from 'vitest';
import { ThoughtAnalyzer } from './analyzer';
import type { ConversationContext } from '../types';
import { THOUGHT_CARDS } from '../types';

const baseContext: ConversationContext = {
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
    text: '',
    timestamp: Date.now(),
  },
};

function createContext(message: string): ConversationContext {
  return {
    ...baseContext,
    currentMessage: {
      ...baseContext.currentMessage,
      text: message,
    },
  };
}

describe('ThoughtAnalyzer', () => {
  it('returns default order when context is missing', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(undefined as unknown as ConversationContext);
    expect(result.recommended).toEqual(['neutral', 'empathy', 'solution', 'humor']);
    expect(result.confidence).toBe(0);
  });

  it('prefers empathy when negative sentiment is detected', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(createContext('今天心情很难过，压力好大'));
    expect(result.recommended[0]).toBe('empathy');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('prefers solution when a question is asked', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(createContext('能不能帮我看看这个方案？'));
    expect(result.recommended[0]).toBe('solution');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('prefers humor for playful tone', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(createContext('哈哈，这个太搞笑了 lol'));
    expect(result.recommended[0]).toBe('humor');
  });

  it('returns matching cards for recommended thoughts', () => {
    const analyzer = new ThoughtAnalyzer();
    const result = analyzer.analyze(createContext('能不能帮我看看这个方案？'));
    const cards = analyzer.getRecommendedCards(result);

    expect(cards.length).toBe(result.recommended.length);
    expect(cards[0]).toEqual(THOUGHT_CARDS[result.recommended[0]]);
  });
});
