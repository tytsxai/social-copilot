import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileUpdater } from './updater';
import type { ContactKey, ContactProfile, LLMInput, LLMOutput, LLMProvider, Message } from '../types';

class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake';
  private responseText: string;
  lastInput: LLMInput | null = null;

  constructor(responseText: string) {
    this.responseText = responseText;
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    this.lastInput = input;
    return {
      candidates: [{
        style: 'rational',
        text: this.responseText,
        confidence: 0.9,
      }],
      model: 'fake-model',
      latency: 1,
    };
  }
}

const contactKey: ContactKey = {
  platform: 'web',
  app: 'telegram',
  accountId: 'acc',
  conversationId: 'conv',
  peerId: 'alice',
  isGroup: false,
};

const buildMessages = (): Message[] => ([
  {
    id: '1',
    contactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: '最近在学摄影',
    timestamp: 1,
  },
  {
    id: '2',
    contactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: '喜欢猫咪',
    timestamp: 2,
  },
]);

const baseProfile: ContactProfile = {
  key: contactKey,
  displayName: 'Alice',
  interests: ['旅行'],
  communicationStyle: {
    prefersShortMessages: false,
  },
  relationshipType: 'friend',
  notes: '已有备注',
  createdAt: 1,
  updatedAt: 1,
};

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shouldUpdate respects configured threshold', () => {
    const updater = new ProfileUpdater(new FakeLLMProvider('{}'), 3);

    expect(updater.shouldUpdate(2, 0)).toBe(false);
    expect(updater.shouldUpdate(3, 0)).toBe(true);
    expect(updater.shouldUpdate(10, 8)).toBe(false);
    expect(updater.shouldUpdate(10, 7)).toBe(true);
  });

  test('extractProfileUpdates uses profile task and merges structured data', async () => {
    const provider = new FakeLLMProvider(
      JSON.stringify({
        interests: ['摄影'],
        communicationStyle: { usesEmoji: true },
        basicInfo: { location: '深圳' },
        notes: '新增备注',
      })
    );
    const updater = new ProfileUpdater(provider);

    const updates = await updater.extractProfileUpdates(buildMessages(), { ...baseProfile });

    expect(provider.lastInput?.task).toBe('profile_extraction');
    expect(provider.lastInput?.context.currentMessage.id).toBe('2');
    expect(provider.lastInput?.memorySummary).toContain('现有画像');

    expect(updates.interests).toEqual(['旅行', '摄影']);
    expect(updates.communicationStyle).toEqual({
      prefersShortMessages: false,
      usesEmoji: true,
    });
    expect(updates.basicInfo?.location).toBe('深圳');
    expect(updates.notes).toContain('2024-01-02');
    expect(updates.notes).toContain('新增备注');
  });

  test('returns empty updates when response is not JSON', async () => {
    const provider = new FakeLLMProvider('non-json response');
    const updater = new ProfileUpdater(provider);

    const updates = await updater.extractProfileUpdates(buildMessages(), { ...baseProfile });
    expect(updates).toEqual({});
  });

  test('ignores non-object sections but still applies other updates', async () => {
    const provider = new FakeLLMProvider(
      JSON.stringify({
        communicationStyle: [],
        relationshipType: 'colleague',
      })
    );
    const updater = new ProfileUpdater(provider);

    const updates = await updater.extractProfileUpdates(buildMessages(), { ...baseProfile });

    expect(updates.communicationStyle).toBeUndefined();
    expect(updates.relationshipType).toBe('colleague');
  });

  test('prevents prototype pollution via LLM JSON', async () => {
    const provider = new FakeLLMProvider(
      JSON.stringify({
        communicationStyle: {
          __proto__: { pollutedByLLM: true },
          usesEmoji: true,
        },
        basicInfo: {
          constructor: { pollutedCtor: true },
          location: '北京',
        },
      })
    );
    const updater = new ProfileUpdater(provider);

    expect(({} as any).pollutedByLLM).toBeUndefined();

    const updates = await updater.extractProfileUpdates(buildMessages(), { ...baseProfile });

    expect(({} as any).pollutedByLLM).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('pollutedByLLM');

    expect(updates.communicationStyle).toEqual({
      prefersShortMessages: false,
      usesEmoji: true,
    });
    expect(updates.basicInfo).toEqual({
      location: '北京',
    });
  });
});
