import type { LLMInput, LLMOutput, ProviderType } from '@social-copilot/core';
import { LLMManager } from '@social-copilot/core';

export interface LLMConfig {
  apiKey: string;
  provider?: ProviderType;
  model?: string;
}

let manager: LLMManager | null = null;

function isLikelyClientRuntime(): boolean {
  if (typeof window !== 'undefined' || typeof document !== 'undefined') return true;
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') return true;
  return false;
}

export function initLLM(config: LLMConfig) {
  if (isLikelyClientRuntime() && !(typeof __DEV__ !== 'undefined' && __DEV__ === true)) {
    throw new Error(
      [
        'Refusing to initialize LLM on the client with an API key.',
        'Do not store API keys in a mobile app; they can be extracted from the bundle/device.',
        'Use a backend proxy: keep the key server-side and have the client send a user session token.',
      ].join(' ')
    );
  }

  const apiKey = (config.apiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('LLM API key is required');
  }
  manager = new LLMManager({
    primary: { provider: config.provider ?? 'deepseek', apiKey, model: config.model },
  });
}

export async function generateReply(input: LLMInput): Promise<LLMOutput> {
  if (!manager) throw new Error('LLM not initialized');
  return manager.generateReply(input);
}
