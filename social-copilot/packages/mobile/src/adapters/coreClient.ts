import type { LLMInput, LLMOutput, ProviderType } from '@social-copilot/core';
import { LLMManager } from '@social-copilot/core';

export interface LLMConfig {
  apiKey: string;
  provider?: ProviderType;
}

let manager: LLMManager | null = null;

export function initLLM(config: LLMConfig) {
  manager = new LLMManager({
    primary: { provider: config.provider ?? 'deepseek', apiKey: config.apiKey },
  });
}

export async function generateReply(input: LLMInput): Promise<LLMOutput> {
  if (!manager) throw new Error('LLM not initialized');
  return manager.generateReply(input);
}
