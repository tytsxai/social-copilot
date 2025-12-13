import type { LLMInput, LLMOutput, ProviderType } from '@social-copilot/core';
import { LLMManager } from '@social-copilot/core';

export interface LLMConfig {
  apiKey: string;
  provider?: ProviderType;
  model?: string;
}

let manager: LLMManager | null = null;

export function initLLM(config: LLMConfig) {
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
