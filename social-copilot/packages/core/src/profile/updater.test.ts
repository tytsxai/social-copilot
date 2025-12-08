import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContactProfile, LLMInput, LLMOutput, LLMProvider, Message } from '../types';
import { ProfileUpdater } from './updater';

class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';

  constructor(private responseText: string) {}

  async generateReply(_input: LLMInput): Promise<LLMOutput> {
    return {
      candidates: [
        {
          style: 'rational',
          text: this.responseText,
          confidence: 0.9,
        },
      ],
      model: 'mock-model',
      latency: 5,
    };
  }
}

const contactKey = {
  platform: 'web' as const,
  app: 'telegram' as const,
  conversationId: 'conv-1',
  peerId: 'alice',
  isGroup: false,
};

const recentMessages: Message[] = [
  {
    id: 'm1',
    contactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: '最近去了上海旅游，超好玩',
    timestamp: 1,
  },
  {
    id: 'm2',
    contactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: '周末还想去逛美食节',
    timestamp: 2,
  },
];

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shouldUpdate respects threshold differences', () => {
    const updater = new ProfileUpdater(new MockLLMProvider('{}'), 5);

    expect(updater.shouldUpdate(4, 0)).toBe(false);
    expect(updater.shouldUpdate(5, 0)).toBe(true);
    expect(updater.shouldUpdate(10, 6)).toBe(false);
    expect(updater.shouldUpdate(11, 6)).toBe(true);
  });

  test('extractProfileUpdates merges structured fields and stamps notes', async () => {
    vi.setSystemTime(new Date('2024-05-01T12:00:00Z'));

    const llmResponse = JSON.stringify({
      interests: ['摄影', '旅行'],
      communicationStyle: {
        usesEmoji: true,
        formalityLevel: 'casual',
      },
      basicInfo: {
        location: '上海',
      },
      relationshipType: 'colleague',
      notes: '喜欢周末出门探索美食',
    });

    const updater = new ProfileUpdater(new MockLLMProvider(llmResponse));
    const profile: ContactProfile = {
      key: contactKey,
      displayName: 'Alice',
      interests: ['摄影'],
      relationshipType: 'friend',
      communicationStyle: {
        prefersShortMessages: false,
      },
      basicInfo: {
        occupation: '工程师',
      },
      notes: '老朋友',
      createdAt: 0,
      updatedAt: 0,
    };

    const updates = await updater.extractProfileUpdates(recentMessages, profile);

    expect(updates.interests).toEqual(['摄影', '旅行']);
    expect(updates.communicationStyle).toEqual({
      prefersShortMessages: false,
      usesEmoji: true,
      formalityLevel: 'casual',
    });
    expect(updates.basicInfo).toEqual({
      occupation: '工程师',
      location: '上海',
    });
    expect(updates.relationshipType).toBe('colleague');
    expect(updates.notes).toContain('[2024-05-01]');
    expect(updates.notes).toContain('喜欢周末出门探索美食');
  });
});
