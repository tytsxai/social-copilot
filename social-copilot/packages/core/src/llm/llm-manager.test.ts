import { describe, test, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { LLMManager, type ProviderType } from './llm-manager';
import { DeepSeekProvider } from './provider';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import type { LLMInput, LLMOutput } from '../types';
const fallbackProviderArb = fc.constantFrom<ProviderType>('openai', 'claude');

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
        text: 'Hello',
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

function buildOutput(model: string): LLMOutput {
  return {
    candidates: [{
      style: 'casual',
      text: 'hi',
      confidence: 0.9,
    }],
    model,
    latency: 12,
  };
}

function mockSuccess(provider: ProviderType, output: LLMOutput) {
  switch (provider) {
    case 'openai':
      return vi.spyOn(OpenAIProvider.prototype, 'generateReply').mockResolvedValue(output);
    case 'claude':
      return vi.spyOn(ClaudeProvider.prototype, 'generateReply').mockResolvedValue(output);
    default:
      return vi.spyOn(DeepSeekProvider.prototype, 'generateReply').mockResolvedValue(output);
  }
}

describe('LLMManager fallback behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Feature: experience-optimization, Property 9: Fallback on primary failure**
   * **Validates: Requirements 3.2**
   */
  test.each(
    fc.sample(fallbackProviderArb, { numRuns: 30 }).map(provider => [provider])
  )('uses fallback provider when primary fails: %#', async (fallbackProvider) => {
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockRejectedValue(new Error('primary failed'));
    const fallbackOutput = buildOutput(`${fallbackProvider}-model`);
    const fallbackSpy = mockSuccess(fallbackProvider, fallbackOutput);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      fallback: { provider: fallbackProvider, apiKey: 'fallback-key' },
    });

    const output = await manager.generateReply({ ...baseInput });

    expect(primarySpy).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(output).toEqual(fallbackOutput);
  });

  /**
   * **Feature: experience-optimization, Property 10: Fallback notification content**
   * **Validates: Requirements 3.3**
   */
  test.each(
    fc.sample(fallbackProviderArb, { numRuns: 30 }).map(provider => [provider])
  )('notifies with provider name when falling back: %#', async (fallbackProvider) => {
    vi.spyOn(DeepSeekProvider.prototype, 'generateReply').mockRejectedValue(new Error('primary down'));
    mockSuccess(fallbackProvider, buildOutput(`${fallbackProvider}-model`));

    let notification = '';
    const manager = new LLMManager(
      {
        primary: { provider: 'deepseek', apiKey: 'primary-key' },
        fallback: { provider: fallbackProvider, apiKey: 'fallback-key' },
      },
      {
        onFallback: (_from, to) => {
          notification = `Using fallback provider: ${to}`;
        },
      }
    );

    await manager.generateReply({ ...baseInput });
    expect(notification).toContain(fallbackProvider);
  });

  /**
   * **Feature: experience-optimization, Property 11: Comprehensive error on all failures**
   * **Validates: Requirements 3.4**
   */
  test('includes both providers when all fail', async () => {
    vi.spyOn(DeepSeekProvider.prototype, 'generateReply').mockRejectedValue(new Error('primary error'));
    vi.spyOn(OpenAIProvider.prototype, 'generateReply').mockRejectedValue(new Error('fallback error'));

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      fallback: { provider: 'openai', apiKey: 'fallback-key' },
    });

    try {
      await manager.generateReply({ ...baseInput });
      throw new Error('Expected failure');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/deepseek/);
      expect(message).toMatch(/openai/);
    }
  });

  /**
   * **Feature: experience-optimization, Property 12: Primary recovery behavior**
   * **Validates: Requirements 3.5**
   */
  test('resumes primary provider after recovery', async () => {
    const primaryOutput = buildOutput('deepseek-model');
    const fallbackOutput = buildOutput('openai-model');

    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockRejectedValueOnce(new Error('temporary error'))
      .mockResolvedValueOnce(primaryOutput);
    const fallbackSpy = vi.spyOn(OpenAIProvider.prototype, 'generateReply')
      .mockResolvedValue(fallbackOutput);
    const recoverySpy = vi.fn();

    const manager = new LLMManager(
      {
        primary: { provider: 'deepseek', apiKey: 'primary-key' },
        fallback: { provider: 'openai', apiKey: 'fallback-key' },
      },
      { onRecovery: recoverySpy }
    );

    const first = await manager.generateReply({ ...baseInput });
    expect(first).toEqual(fallbackOutput);

    const second = await manager.generateReply({ ...baseInput });
    expect(second).toEqual(primaryOutput);

    expect(primarySpy).toHaveBeenCalledTimes(2);
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(recoverySpy).toHaveBeenCalledWith('deepseek');
  });
});
