import { describe, test, expect, afterEach, vi } from 'vitest';
import { NvidiaProvider } from './nvidia';
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

describe('NvidiaProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateApiKey', () => {
    test('accepts valid nvapi- prefixed keys', () => {
      expect(NvidiaProvider.validateApiKey('nvapi-abc123')).toBe(true);
      expect(NvidiaProvider.validateApiKey('nvapi-OEt0r7hsWGjnZF2L3cbBi2XDWxmohTBQ5LLrRKVqIZMApcFXb')).toBe(true);
    });

    test('rejects keys without nvapi- prefix', () => {
      expect(NvidiaProvider.validateApiKey('sk-abc123')).toBe(false);
      expect(NvidiaProvider.validateApiKey('abc123')).toBe(false);
    });

    test('rejects empty or whitespace keys', () => {
      expect(NvidiaProvider.validateApiKey('')).toBe(false);
      expect(NvidiaProvider.validateApiKey('   ')).toBe(false);
      expect(NvidiaProvider.validateApiKey('nvapi- space')).toBe(false);
    });
  });

  describe('constructor', () => {
    test('throws on invalid API key', () => {
      expect(() => new NvidiaProvider({ apiKey: 'invalid' })).toThrow('Invalid NVIDIA apiKey');
    });

    test('uses default baseUrl and model', () => {
      const provider = new NvidiaProvider({ apiKey: 'nvapi-test123' });
      expect(provider.name).toBe('nvidia');
    });
  });

  describe('generateReply', () => {
    test('parses reply content from choices[0].message.content', async () => {
      const provider = new NvidiaProvider({ apiKey: 'nvapi-test123' });

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
      expect(output.model).toBe('z-ai/glm4.7');
    });

    test('throws a clear error when response structure is invalid', async () => {
      const provider = new NvidiaProvider({ apiKey: 'nvapi-test123' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));

      await expect(provider.generateReply(baseInput))
        .rejects.toThrow(/Invalid response structure/);
    });

    test('handles API error responses', async () => {
      const provider = new NvidiaProvider({ apiKey: 'nvapi-test123' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      }));

      await expect(provider.generateReply(baseInput))
        .rejects.toThrow(/NVIDIA API error: 401/);
    });
  });
});
