import type { LLMInput, LLMOutput, LLMProvider } from '../types';
import { ReplyParseError } from './reply-validation';
import { DeepSeekProvider } from './provider';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import type { PromptHookRegistry } from './prompt-hooks';

export type ProviderType = 'deepseek' | 'openai' | 'claude';

export interface LLMManagerConfig {
  primary: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
  fallback?: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
  cache?: {
    enabled?: boolean;
    size?: number;
    ttl?: number;
  };
}

export interface LLMManagerEvents {
  onFallback?: (fromProvider: string, toProvider: string, error: Error) => void;
  onRecovery?: (provider: string) => void;
  onAllFailed?: (errors: Error[]) => void;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

interface CacheEntry {
  value: LLMOutput;
  timestamp: number;
}

interface LRUNode {
  key: string;
  value: CacheEntry;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * Lightweight LRU Cache implementation
 */
class LRUCache {
  private capacity: number;
  private ttl: number;
  private cache = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;

  constructor(capacity: number, ttl: number) {
    this.capacity = capacity;
    this.ttl = ttl;
  }

  get(key: string): LLMOutput | null {
    const node = this.cache.get(key);
    if (!node) return null;

    // Check TTL
    if (Date.now() - node.value.timestamp > this.ttl) {
      this.remove(key);
      return null;
    }

    // Move to head (most recently used) - this updates access order
    this.moveToHead(node);
    return node.value.value;
  }

  set(key: string, value: LLMOutput): void {
    const existing = this.cache.get(key);
    if (existing) {
      // Update existing entry and move to head
      existing.value = { value, timestamp: Date.now() };
      this.moveToHead(existing);
      return;
    }

    // Create new node
    const node: LRUNode = {
      key,
      value: { value, timestamp: Date.now() },
      prev: null,
      next: null,
    };

    this.cache.set(key, node);
    this.addToHead(node);

    // Evict LRU if over capacity
    if (this.cache.size > this.capacity) {
      const removed = this.removeTail();
      if (removed) this.cache.delete(removed.key);
    }
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  private addToHead(node: LRUNode): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LRUNode): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): LRUNode | null {
    const node = this.tail;
    if (node) {
      this.removeNode(node);
    }
    return node;
  }

  private remove(key: string): void {
    const node = this.cache.get(key);
    if (node) {
      this.removeNode(node);
      this.cache.delete(key);
    }
  }
}

/**
 * LLM Manager with automatic fallback support, request deduplication, and LRU caching
 *
 * Manages primary and fallback LLM providers, automatically switching
 * to fallback when primary fails and recovering when primary is healthy again.
 * Includes request deduplication for concurrent identical requests and LRU caching.
 */
export class LLMManager {
  private primaryProvider: LLMProvider;
  private fallbackProvider: LLMProvider | null = null;
  private events: LLMManagerEvents;
  private registry?: PromptHookRegistry;
  private primaryFailed = false;
  private primaryFailedAt = 0;
  private primaryFailureCount = 0;
  private readonly primaryCooldownMs = 15_000;

  // Cache and deduplication
  private cache: LRUCache | null = null;
  private deduplicationMap = new Map<string, Promise<LLMOutput>>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: LLMManagerConfig, events: LLMManagerEvents = {}, registry?: PromptHookRegistry) {
    this.events = events;
    this.registry = registry;
    this.primaryProvider = this.createProvider(config.primary);

    if (config.fallback?.apiKey) {
      this.fallbackProvider = this.createProvider(config.fallback);
    }

    // Initialize cache if enabled
    const cacheEnabled = config.cache?.enabled ?? true;
    if (cacheEnabled) {
      const cacheSize = config.cache?.size ?? 100;
      const cacheTTL = config.cache?.ttl ?? 300_000; // 5 minutes
      this.cache = new LRUCache(cacheSize, cacheTTL);
    }
  }

  private createProvider(config: { provider: ProviderType; apiKey: string; model?: string; baseUrl?: string }): LLMProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, registry: this.registry });
      case 'claude':
        return new ClaudeProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, registry: this.registry });
      case 'deepseek':
      default:
        return new DeepSeekProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, registry: this.registry });
    }
  }


  /**
   * Generate cache key from input
   */
  private generateCacheKey(input: LLMInput): string {
    // Use JSON.stringify for simple hash generation
    const inputStr = JSON.stringify(input);

    // Simple hash function (djb2)
    let hash = 5381;
    for (let i = 0; i < inputStr.length; i++) {
      hash = ((hash << 5) + hash) + inputStr.charCodeAt(i);
    }
    return hash.toString(36);
  }

  /**
   * Generate reply with automatic fallback handling, deduplication, and caching
   */
  async generateReply(input: LLMInput): Promise<LLMOutput> {
    // Generate cache key before any modifications
    const cacheKey = this.generateCacheKey(input);

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
    }

    // Check deduplication map for in-flight requests
    const existingRequest = this.deduplicationMap.get(cacheKey);
    if (existingRequest) {
      // Don't count as cache miss - this is deduplication
      return existingRequest;
    }

    // This is a true cache miss - new request needed
    if (this.cache) {
      this.cacheMisses++;
    }

    // Create new request
    const requestPromise = this.executeRequest(input);
    this.deduplicationMap.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // Cache successful result
      if (this.cache) {
        this.cache.set(cacheKey, result);
      }

      return result;
    } finally {
      // Clean up deduplication map
      this.deduplicationMap.delete(cacheKey);
    }
  }

  /**
   * Execute the actual request with fallback handling
   */
  private async executeRequest(input: LLMInput): Promise<LLMOutput> {
    const errors: Error[] = [];
    const now = Date.now();

    // helper to attempt provider call with one retry on parse error
    const invokeWithRetry = async (provider: LLMProvider, attemptInput: LLMInput): Promise<LLMOutput> => {
      try {
        return await provider.generateReply(attemptInput);
      } catch (err) {
        if (!(err instanceof ReplyParseError)) throw err;

        // One-time retry with stricter JSON reminder appended to thought hint
        const retryInput: LLMInput = {
          ...attemptInput,
          thoughtHint: `${attemptInput.thoughtHint ?? ''}\n请务必只返回严格的 JSON 数组，格式为 [{"style":"...","text":"..."}]，不要添加任何额外说明。`.trim(),
        };

        return provider.generateReply(retryInput);
      }
    };

    // If primary previously failed but we want to try recovery
    if (this.primaryFailed) {
      const withinCooldown = this.primaryFailureCount > 1 && (now - this.primaryFailedAt) < this.primaryCooldownMs;
      if (withinCooldown) {
        const cooldownError = new Error(`Primary provider in cooldown for ${this.primaryCooldownMs}ms`);
        errors.push(cooldownError);
        if (this.fallbackProvider) {
          this.events.onFallback?.(
            this.primaryProvider.name,
            this.fallbackProvider.name,
            cooldownError
          );
        }
      } else {
        try {
          const result = await invokeWithRetry(this.primaryProvider, input);
          // Primary recovered
          this.primaryFailed = false;
          this.primaryFailedAt = 0;
          this.primaryFailureCount = 0;
          this.events.onRecovery?.(this.primaryProvider.name);
          return result;
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
          // Primary still failing, try fallback
          this.primaryFailedAt = Date.now();
          this.primaryFailureCount += 1;
        }
      }
    } else {
      // Try primary first
      try {
        return await invokeWithRetry(this.primaryProvider, input);
      } catch (error) {
        const primaryError = error instanceof Error ? error : new Error(String(error));
        errors.push(primaryError);
        this.primaryFailed = true;
        this.primaryFailedAt = Date.now();
        this.primaryFailureCount = 1;

        // Try fallback if configured
        if (this.fallbackProvider) {
          this.events.onFallback?.(
            this.primaryProvider.name,
            this.fallbackProvider.name,
            primaryError
          );
        }
      }
    }

    // Try fallback provider
    if (this.fallbackProvider) {
      try {
        return await invokeWithRetry(this.fallbackProvider, input);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // All providers failed
    this.events.onAllFailed?.(errors);
    
    const errorMessages = errors.map((e, i) => {
      const providerName = i === 0 ? this.primaryProvider.name : this.fallbackProvider?.name || 'fallback';
      return `${providerName}: ${e.message}`;
    });
    
    throw new Error(`All LLM providers failed: ${errorMessages.join('; ')}`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  /**
   * Clear cache and reset statistics
   */
  clearCache(): void {
    this.cache?.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Update manager configuration
   */
  updateConfig(config: LLMManagerConfig): void {
    this.primaryProvider = this.createProvider(config.primary);
    this.fallbackProvider = config.fallback?.apiKey
      ? this.createProvider(config.fallback)
      : null;
    this.primaryFailed = false;
    this.primaryFailedAt = 0;
    this.primaryFailureCount = 0;

    // Reinitialize cache if config changed
    const cacheEnabled = config.cache?.enabled ?? true;
    if (cacheEnabled) {
      const cacheSize = config.cache?.size ?? 100;
      const cacheTTL = config.cache?.ttl ?? 300_000;
      this.cache = new LRUCache(cacheSize, cacheTTL);
    } else {
      this.cache = null;
    }
    this.clearCache();
  }

  /**
   * Get the name of the currently active provider
   */
  getActiveProvider(): string {
    if (this.primaryFailed && this.fallbackProvider) {
      return this.fallbackProvider.name;
    }
    return this.primaryProvider.name;
  }

  /**
   * Check if fallback is configured
   */
  hasFallback(): boolean {
    return this.fallbackProvider !== null;
  }

  /**
   * Reset primary failed state to force retry on primary
   */
  resetPrimaryState(): void {
    this.primaryFailed = false;
    this.primaryFailedAt = 0;
    this.primaryFailureCount = 0;
  }
}
