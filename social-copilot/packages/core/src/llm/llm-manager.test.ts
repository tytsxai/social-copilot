import { describe, test, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { LLMManager, type ProviderType } from './llm-manager';
import { DeepSeekProvider } from './provider';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { ReplyParseError } from './reply-validation';
import type { LLMInput, LLMOutput, ReplyStyle } from '../types';
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
	      fallback: { provider: fallbackProvider, apiKey: fallbackProvider === 'claude' ? 'sk-ant-fallback' : 'fallback-key' },
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
	        fallback: { provider: fallbackProvider, apiKey: fallbackProvider === 'claude' ? 'sk-ant-fallback' : 'fallback-key' },
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
        cache: { enabled: false }, // Disable cache for this test
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

  /**
   * **Feature: reply-validation, Property 2: Retry on parse errors**
   * **Validates: Requirements 2.2**
   */
  test('retries once with stricter JSON hint when provider throws ReplyParseError', async () => {
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockRejectedValueOnce(new ReplyParseError('bad json'))
      .mockResolvedValueOnce(buildOutput('deepseek-model'));

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    const inputWithHint: LLMInput = {
      ...baseInput,
      thoughtHint: '原始思路提示',
    };

    const output = await manager.generateReply(inputWithHint);

    expect(output.model).toBe('deepseek-model');
    expect(primarySpy).toHaveBeenCalledTimes(2);
    const retryPayload = primarySpy.mock.calls[1][0] as LLMInput;
    expect(retryPayload.thoughtHint).toContain('原始思路提示');
    expect(retryPayload.thoughtHint).toContain('请务必只返回严格的 JSON 数组');
  });
});

describe('LLMManager caching and deduplication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: request-deduplication**
   * **Validates: Concurrent identical requests share the same Promise**
   */
  test('deduplicates concurrent identical requests', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValue(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // Fire 5 concurrent identical requests
    const promises = Array.from({ length: 5 }, () =>
      manager.generateReply({ ...baseInput })
    );

    const results = await Promise.all(promises);

    // Should only call provider once
    expect(primarySpy).toHaveBeenCalledTimes(1);
    // All results should be identical
    results.forEach(result => expect(result).toEqual(output));
  });

  /**
   * **Feature: cache-hit**
   * **Validates: Cache returns stored result for identical input**
   */
  test('returns cached result for identical input', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValue(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // First request - cache miss
    const first = await manager.generateReply({ ...baseInput });
    expect(first).toEqual(output);
    expect(primarySpy).toHaveBeenCalledTimes(1);

    // Second request - cache hit
    const second = await manager.generateReply({ ...baseInput });
    expect(second).toEqual(output);
    expect(primarySpy).toHaveBeenCalledTimes(1); // Still only 1 call

    // Verify cache stats
    const stats = manager.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  /**
   * **Feature: cache-miss**
   * **Validates: Different inputs result in cache misses**
   */
  test('cache miss for different inputs', async () => {
    const output1 = buildOutput('deepseek-model-1');
    const output2 = buildOutput('deepseek-model-2');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValueOnce(output1)
      .mockResolvedValueOnce(output2);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    const input1: LLMInput = { ...baseInput, styles: ['casual'] };
    const input2: LLMInput = { ...baseInput, styles: ['formal'] };

    await manager.generateReply(input1);
    await manager.generateReply(input2);

    expect(primarySpy).toHaveBeenCalledTimes(2);

    const stats = manager.getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(2);
  });

  /**
   * **Feature: cache-ttl**
   * **Validates: Cache entries expire after TTL**
   */
  test('cache entries expire after TTL', async () => {
    vi.useFakeTimers();

    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValue(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      cache: { enabled: true, size: 100, ttl: 5000 }, // 5 seconds TTL
    });

    // First request
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(1);

    // Advance time by 3 seconds (within TTL)
    vi.advanceTimersByTime(3000);
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(1); // Cache hit

    // Advance time by 3 more seconds (total 6 seconds, beyond TTL)
    vi.advanceTimersByTime(3000);
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(2); // Cache miss, new request
  });

  /**
   * **Feature: lru-eviction**
   * **Validates: LRU eviction when cache is full**
   */
  test('evicts least recently used entries when cache is full', async () => {
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockImplementation(async (input) => {
        return buildOutput(`model-${input.styles[0]}`);
      });

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      cache: { enabled: true, size: 3, ttl: 300000 }, // Cache size = 3
    });

    // Fill cache with 3 entries
    // Cache state: head -> style3 -> style2 -> style1 -> tail
    const lruStyles: ReplyStyle[] = ['casual', 'formal', 'humorous', 'caring', 'rational'];

    await manager.generateReply({ ...baseInput, styles: [lruStyles[0]] });
    await manager.generateReply({ ...baseInput, styles: [lruStyles[1]] });
    await manager.generateReply({ ...baseInput, styles: [lruStyles[2]] });
    expect(primarySpy).toHaveBeenCalledTimes(3);

    // Access style1 to make it most recently used
    // Cache state: head -> style1 -> style3 -> style2 -> tail
    await manager.generateReply({ ...baseInput, styles: [lruStyles[0]] });
    expect(primarySpy).toHaveBeenCalledTimes(3); // Cache hit

    // Add 4th entry, should evict style2 (least recently used, at tail)
    // Cache state: head -> style4 -> style1 -> style3 -> tail
    await manager.generateReply({ ...baseInput, styles: [lruStyles[3]] });
    expect(primarySpy).toHaveBeenCalledTimes(4);

    // Verify style2 was evicted (cache miss)
    await manager.generateReply({ ...baseInput, styles: [lruStyles[1]] });
    expect(primarySpy).toHaveBeenCalledTimes(5);

    // Verify style1 is still cached (cache hit)
    await manager.generateReply({ ...baseInput, styles: [lruStyles[0]] });
    expect(primarySpy).toHaveBeenCalledTimes(5); // Cache hit

    // Verify style4 is still cached (cache hit)
    await manager.generateReply({ ...baseInput, styles: [lruStyles[3]] });
    expect(primarySpy).toHaveBeenCalledTimes(5); // Cache hit
  });

  /**
   * **Feature: cache-disabled**
   * **Validates: Cache can be disabled**
   */
  test('cache can be disabled', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValue(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      cache: { enabled: false },
    });

    await manager.generateReply({ ...baseInput });
    await manager.generateReply({ ...baseInput });

    // Should call provider twice (no caching)
    expect(primarySpy).toHaveBeenCalledTimes(2);

    const stats = manager.getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  /**
   * **Feature: cache-clear**
   * **Validates: Cache can be cleared**
   */
  test('clearCache removes all cached entries and resets stats', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockResolvedValue(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // Cache a result
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(1);

    // Verify cache hit
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(1);

    let stats = manager.getCacheStats();
    expect(stats.hits).toBe(1);

    // Clear cache
    manager.clearCache();

    // Should be cache miss now
    await manager.generateReply({ ...baseInput });
    expect(primarySpy).toHaveBeenCalledTimes(2);

    stats = manager.getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
  });

  /**
   * **Feature: error-not-cached**
   * **Validates: Errors are not cached**
   */
  test('does not cache errors', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockRejectedValueOnce(new Error('temporary error'))
      .mockResolvedValueOnce(output);

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // First request fails
    try {
      await manager.generateReply({ ...baseInput });
    } catch (err) {
      expect((err as Error).message).toContain('temporary error');
    }

    // Second request should retry (error not cached)
    const result = await manager.generateReply({ ...baseInput });
    expect(result).toEqual(output);
    expect(primarySpy).toHaveBeenCalledTimes(2);
  });

  /**
   * **Feature: performance-test**
   * **Validates: Cache reduces API calls by ≥20%**
   */
  test('performance test: cache reduces API calls by ≥20%', async () => {
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockImplementation(async (input) => {
        return buildOutput(`model-${input.styles[0]}`);
      });

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // Simulate 100 requests with 50% duplication (sequential to test cache, not deduplication)
    const requests: LLMInput[] = [];
    const perfStyles: ReplyStyle[] = ['casual', 'formal', 'humorous', 'caring', 'rational'];
    for (let i = 0; i < 100; i++) {
      // Create 50 unique inputs, each used twice
      const styleIndex = Math.floor(i / 2);
      requests.push({ ...baseInput, styles: [perfStyles[styleIndex % perfStyles.length]] });
    }

    // Execute requests sequentially to test cache (not deduplication)
    for (const input of requests) {
      await manager.generateReply(input);
    }

    // With 50% duplication, should only make ~50 API calls
    const apiCalls = primarySpy.mock.calls.length;
    const reduction = (100 - apiCalls) / 100;

    expect(apiCalls).toBeLessThanOrEqual(80); // At least 20% reduction
    expect(reduction).toBeGreaterThanOrEqual(0.2);

    const stats = manager.getCacheStats();
    expect(stats.hits).toBeGreaterThanOrEqual(20); // At least 20 cache hits
    expect(stats.hitRate).toBeGreaterThanOrEqual(0.2); // At least 20% hit rate

    console.log(`Performance test results:
      Total requests: 100
      API calls: ${apiCalls}
      Reduction: ${(reduction * 100).toFixed(1)}%
      Cache hits: ${stats.hits}
      Cache misses: ${stats.misses}
      Hit rate: ${(stats.hitRate * 100).toFixed(1)}%
    `);
  });

  /**
   * **Feature: deduplication-with-cache**
   * **Validates: Deduplication works together with cache**
   */
  test('deduplication and cache work together', async () => {
    const output = buildOutput('deepseek-model');
    const primarySpy = vi.spyOn(DeepSeekProvider.prototype, 'generateReply')
      .mockImplementation(async () => {
        // Simulate slow API call
        await new Promise(resolve => setTimeout(resolve, 100));
        return output;
      });

    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
    });

    // Fire 3 concurrent requests (deduplication)
    // First request: cache miss (cacheMisses = 1)
    // Second and third requests: deduplication (no cache stat change)
    const concurrent = await Promise.all([
      manager.generateReply({ ...baseInput }),
      manager.generateReply({ ...baseInput }),
      manager.generateReply({ ...baseInput }),
    ]);

    expect(primarySpy).toHaveBeenCalledTimes(1); // Deduplication
    concurrent.forEach(result => expect(result).toEqual(output));

    // Verify deduplication doesn't count as cache miss
    let stats = manager.getCacheStats();
    expect(stats.misses).toBe(1); // Only the first request counted as miss

    // Wait for deduplication to clear
    await new Promise(resolve => setTimeout(resolve, 150));

    // Fire 2 more requests (cache hit)
    await manager.generateReply({ ...baseInput });
    await manager.generateReply({ ...baseInput });

    expect(primarySpy).toHaveBeenCalledTimes(1); // Still only 1 call

    stats = manager.getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });
});

describe('LLMManager cache key', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('different inputs produce different cache keys', async () => {
    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      cache: { enabled: false },
    });

    const input1: LLMInput = { ...baseInput, styles: ['casual'] };
    const input2: LLMInput = { ...baseInput, styles: ['formal'] };

    const key1 = (manager as any).generateCacheKey(input1) as string;
    const key2 = (manager as any).generateCacheKey(input2) as string;
    expect(key1).not.toEqual(key2);
  });

  test('logically identical objects produce the same cache key (stable serialization)', async () => {
    const manager = new LLMManager({
      primary: { provider: 'deepseek', apiKey: 'primary-key' },
      cache: { enabled: false },
    });

    const inputA: LLMInput = {
      language: 'zh',
      styles: ['casual'],
      context: baseInput.context,
    };

    const inputB: LLMInput = {
      context: baseInput.context,
      styles: ['casual'],
      language: 'zh',
    };

    const keyA = (manager as any).generateCacheKey(inputA) as string;
    const keyB = (manager as any).generateCacheKey(inputB) as string;
    expect(keyA).toEqual(keyB);
  });
});
