import type { LLMInput, LLMOutput, LLMProvider } from '../types';
import { ReplyParseError } from './reply-validation';
import { DeepSeekProvider } from './provider';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';

export type ProviderType = 'deepseek' | 'openai' | 'claude';

export interface LLMManagerConfig {
  primary: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
  };
  fallback?: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
  };
}

export interface LLMManagerEvents {
  onFallback?: (fromProvider: string, toProvider: string, error: Error) => void;
  onRecovery?: (provider: string) => void;
  onAllFailed?: (errors: Error[]) => void;
}

/**
 * LLM Manager with automatic fallback support
 * 
 * Manages primary and fallback LLM providers, automatically switching
 * to fallback when primary fails and recovering when primary is healthy again.
 */
export class LLMManager {
  private primaryProvider: LLMProvider;
  private fallbackProvider: LLMProvider | null = null;
  private events: LLMManagerEvents;
  private primaryFailed = false;

  constructor(config: LLMManagerConfig, events: LLMManagerEvents = {}) {
    this.events = events;
    this.primaryProvider = this.createProvider(config.primary);
    
    if (config.fallback?.apiKey) {
      this.fallbackProvider = this.createProvider(config.fallback);
    }
  }

  private createProvider(config: { provider: ProviderType; apiKey: string; model?: string }): LLMProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider({ apiKey: config.apiKey, model: config.model });
      case 'claude':
        return new ClaudeProvider({ apiKey: config.apiKey, model: config.model });
      case 'deepseek':
      default:
        return new DeepSeekProvider({ apiKey: config.apiKey, model: config.model });
    }
  }


  /**
   * Generate reply with automatic fallback handling
   */
  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const errors: Error[] = [];

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
      try {
        const result = await invokeWithRetry(this.primaryProvider, input);
        // Primary recovered
        this.primaryFailed = false;
        this.events.onRecovery?.(this.primaryProvider.name);
        return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        // Primary still failing, try fallback
      }
    } else {
      // Try primary first
      try {
        return await invokeWithRetry(this.primaryProvider, input);
      } catch (error) {
        const primaryError = error instanceof Error ? error : new Error(String(error));
        errors.push(primaryError);
        this.primaryFailed = true;

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
   * Update manager configuration
   */
  updateConfig(config: LLMManagerConfig): void {
    this.primaryProvider = this.createProvider(config.primary);
    this.fallbackProvider = config.fallback?.apiKey 
      ? this.createProvider(config.fallback) 
      : null;
    this.primaryFailed = false;
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
  }
}
