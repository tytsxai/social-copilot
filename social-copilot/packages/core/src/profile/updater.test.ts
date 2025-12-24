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

class BlockingLLMProvider implements LLMProvider {
  readonly name = 'blocking';
  inflight = 0;
  maxInflight = 0;
  deferreds: Array<() => void> = [];

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    void input;
    this.inflight += 1;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    const gate = new Promise<void>((resolve) => {
      this.deferreds.push(resolve);
    });
    await gate;
    this.inflight -= 1;
    return {
      candidates: [{
        style: 'rational',
        text: '{}',
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

const buildMessages = (key: ContactKey = contactKey): Message[] => ([
  {
    id: '1',
    contactKey: key,
    direction: 'incoming',
    senderName: 'Alice',
    text: '最近在学摄影',
    timestamp: 1,
  },
  {
    id: '2',
    contactKey: key,
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
  const flushMicrotasks = async (times = 2) => {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve();
    }
  };

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

  test('throws typed error when existingProfile.interests is malformed', async () => {
    const provider = new FakeLLMProvider('{}');
    const updater = new ProfileUpdater(provider);
    const badProfile = { ...baseProfile, interests: '旅行' as any } as any;

    await expect(updater.extractProfileUpdates(buildMessages(), badProfile)).rejects.toEqual(
      expect.objectContaining({ name: 'ProfileUpdaterError', code: 'INVALID_EXISTING_PROFILE' })
    );
    expect(provider.lastInput).toBeNull();
  });

  test('sanitizes interests elements from both existing profile and LLM response', async () => {
    const provider = new FakeLLMProvider(
      JSON.stringify({
        interests: ['摄影', '  ', 1, 'x'.repeat(200)],
      })
    );
    const updater = new ProfileUpdater(provider);
    const dirtyProfile = {
      ...baseProfile,
      interests: ['旅行', '', '  ', '旅行', 'y'.repeat(200), 123 as any] as any,
    };

    const updates = await updater.extractProfileUpdates(buildMessages(), dirtyProfile as any);

    expect(provider.lastInput?.memorySummary).toContain('兴趣：旅行');
    expect(provider.lastInput?.memorySummary).not.toContain('y'.repeat(200));
    expect(updates.interests).toEqual(['旅行', '摄影']);
  });

  test('limits interests array length when merging', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `兴趣${i + 1}`);
    const provider = new FakeLLMProvider(JSON.stringify({ interests: ['新增'] }));
    const updater = new ProfileUpdater(provider);
    const profile = { ...baseProfile, interests: many };

    const updates = await updater.extractProfileUpdates(buildMessages(), profile);

    expect(updates.interests?.length).toBeLessThanOrEqual(20);
    expect(updates.interests).toContain('新增');
  });

  test('serializes updates for the same contact', async () => {
    const provider = new BlockingLLMProvider();
    const updater = new ProfileUpdater(provider);

    const first = updater.extractProfileUpdates(buildMessages(), { ...baseProfile });
    await flushMicrotasks();
    expect(provider.deferreds.length).toBe(1);

    const second = updater.extractProfileUpdates(buildMessages(), { ...baseProfile });
    await flushMicrotasks();
    expect(provider.deferreds.length).toBe(1);

    provider.deferreds[0]();
    await first;
    await flushMicrotasks();
    expect(provider.deferreds.length).toBe(2);

    provider.deferreds[1]();
    await Promise.all([first, second]);
    expect(provider.maxInflight).toBe(1);
  });

  test('allows parallel updates for different contacts', async () => {
    const provider = new BlockingLLMProvider();
    const updater = new ProfileUpdater(provider);
    const contactKeyB = { ...contactKey, conversationId: 'conv-2', peerId: 'bob' };
    const profileB = { ...baseProfile, key: contactKeyB, displayName: 'Bob' };

    const first = updater.extractProfileUpdates(buildMessages(), { ...baseProfile });
    const second = updater.extractProfileUpdates(buildMessages(contactKeyB), profileB);
    await Promise.resolve();

    expect(provider.deferreds.length).toBe(2);
    expect(provider.maxInflight).toBe(2);

    provider.deferreds.forEach((resolve) => resolve());
    await Promise.all([first, second]);
  });
});
