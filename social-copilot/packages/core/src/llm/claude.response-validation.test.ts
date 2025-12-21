import { describe, test, expect, afterEach, vi } from 'vitest';
import { ClaudeProvider } from './claude';
import type { LLMInput } from '../types';

const baseInput: LLMInput = {
  context: {
    contactKey: {
      platform: 'web',
      app: 'telegram',
      accountId: 'acc',
      conversationId: 'conv',
      peerId: 'peer',
      isGroup: false,
    },
    recentMessages: [
      {
        id: '1',
        contactKey: {
          platform: 'web',
          app: 'telegram',
          accountId: 'acc',
          conversationId: 'conv',
          peerId: 'peer',
          isGroup: false,
        },
        direction: 'incoming',
        senderName: 'Alice',
        text: 'Hi!',
        timestamp: Date.now(),
      },
    ],
    currentMessage: {
      id: '2',
      contactKey: {
        platform: 'web',
        app: 'telegram',
        accountId: 'acc',
        conversationId: 'conv',
        peerId: 'peer',
        isGroup: false,
      },
      direction: 'incoming',
      senderName: 'Alice',
      text: 'How are you?',
      timestamp: Date.now(),
    },
  },
  styles: ['casual'],
  language: 'zh',
};

describe('ClaudeProvider response validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws a clear error when response structure is invalid', async () => {
    const provider = new ClaudeProvider({ apiKey: 'sk-ant-test' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    await expect(provider.generateReply(baseInput))
      .rejects.toThrow(/Invalid Claude response structure/);
  });
});

