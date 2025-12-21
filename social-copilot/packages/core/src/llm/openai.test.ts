import { describe, test, expect, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './openai';
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

describe('OpenAIProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('parses reply content from choices[0].message.content', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl_1',
        choices: [
          {
            message: {
              content: JSON.stringify([{ style: 'casual', text: 'hello' }]),
            },
          },
        ],
      }),
    }));

    const output = await provider.generateReply(baseInput);
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0].style).toBe('casual');
    expect(output.candidates[0].text).toBe('hello');
  });

  test('throws a clear error when response structure is invalid', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    await expect(provider.generateReply(baseInput))
      .rejects.toThrow(/Invalid OpenAI response structure/);
  });
});

