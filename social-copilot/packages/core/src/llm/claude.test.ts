import { describe, test, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ClaudeProvider } from './claude';
import { ReplyParseError } from './reply-validation';
import type { LLMInput, ReplyStyle } from '../types';

const replyStyleArb = fc.constantFrom<ReplyStyle>('humorous', 'caring', 'rational', 'casual', 'formal');

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

describe('ClaudeProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Feature: experience-optimization, Property 5: API key validation format**
   * **Validates: Requirements 2.2**
   */
  describe('API key validation', () => {
    // Generator for valid Claude API keys (starts with "sk-ant-")
    const validApiKeyArb = fc.string({ minLength: 1, maxLength: 100 }).map(
      suffix => `sk-ant-${suffix}`
    );

    // Generator for invalid API keys (does not start with "sk-ant-")
    const invalidApiKeyArb = fc.oneof(
      // Empty string
      fc.constant(''),
      // Random strings that don't start with sk-ant-
      fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.startsWith('sk-ant-')),
      // Strings with similar but incorrect prefixes
      fc.constantFrom('sk-', 'sk-ant', 'ant-', 'sk_ant_', 'SK-ANT-').chain(
        prefix => fc.string({ minLength: 0, maxLength: 50 })
          .filter(suffix => !suffix.startsWith('-') || prefix !== 'sk-ant')
          .map(suffix => prefix + suffix)
      )
    );

    test.each(
      fc.sample(validApiKeyArb, { numRuns: 100 }).map(key => [key])
    )('should accept valid API key with sk-ant- prefix: %#', (apiKey) => {
      expect(ClaudeProvider.validateApiKey(apiKey)).toBe(true);
    });

    test.each(
      fc.sample(invalidApiKeyArb, { numRuns: 100 }).map(key => [key])
    )('should reject invalid API key without sk-ant- prefix: %#', (apiKey) => {
      expect(ClaudeProvider.validateApiKey(apiKey)).toBe(false);
    });
  });

  /**
   * **Feature: experience-optimization, Property 6: LLM response parsing round-trip**
   * **Validates: Requirements 2.3**
   */
  describe('response parsing', () => {
    const nonEmptyTextArb = fc.string({ minLength: 1, maxLength: 120 }).filter(text => text.trim().length > 0);
    const responseItemsArb = fc.array(
      fc.record({
        style: replyStyleArb,
        text: nonEmptyTextArb,
      }),
      { minLength: 1, maxLength: 5 }
    );

    test.each(
      fc.sample(responseItemsArb, { numRuns: 50 }).map(items => [items])
    )('parses candidates matching requested styles: %#', async (items) => {
      const styles = items.map(item => item.style);
      const provider = new ClaudeProvider({ apiKey: 'test-key' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg_1',
          content: [
            { text: JSON.stringify(items) },
          ],
        }),
      }));

      const input: LLMInput = { ...baseInput, styles };
      const output = await provider.generateReply(input);

      expect(output.candidates).toHaveLength(items.length);
      expect(output.candidates.map(c => c.style)).toEqual(styles);
      expect(output.candidates.map(c => c.text)).toEqual(items.map(i => i.text));
    });

    test('rejects candidates with blank text', async () => {
      const provider = new ClaudeProvider({ apiKey: 'test-key' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg_1',
          content: [
            { text: JSON.stringify([{ style: 'formal', text: '   ' }]) },
          ],
        }),
      }));

      await expect(provider.generateReply({ ...baseInput, styles: ['formal'] }))
        .rejects.toBeInstanceOf(ReplyParseError);
    });
  });

  /**
   * **Feature: experience-optimization, Property 7: Error message on API failure**
   * **Validates: Requirements 2.4**
   */
  describe('error handling', () => {
    const errorCaseArb = fc.tuple(
      fc.integer({ min: 400, max: 599 }),
      fc.option(fc.string({ minLength: 5, maxLength: 80 }), { nil: undefined })
    );

    test.each(
      fc.sample(errorCaseArb, { numRuns: 50 }).map(tuple => [tuple])
    )('produces clear error message when API fails: %#', async (tuple) => {
      const [status, maybeMessage] = tuple;
      const provider = new ClaudeProvider({ apiKey: 'test-key' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => maybeMessage ? { error: { message: maybeMessage } } : {},
      }));

      let thrown: unknown = null;
      try {
        await provider.generateReply(baseInput);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain(`Claude API error: ${status}`);
      if (maybeMessage) {
        expect(message).toContain(maybeMessage);
      }
    });
  });
});
