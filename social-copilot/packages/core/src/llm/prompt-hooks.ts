import type { LLMInput } from '../types';

export interface PromptHook {
  name: string;
  transformSystemPrompt?: (prompt: string, input: LLMInput) => string;
  transformUserPrompt?: (prompt: string, input: LLMInput) => string;
}

const promptHooks: PromptHook[] = [];

export function registerPromptHook(hook: PromptHook): void {
  promptHooks.push(hook);
}

export function clearPromptHooks(): void {
  promptHooks.length = 0;
}

export function getPromptHooks(): readonly PromptHook[] {
  return promptHooks;
}

export function applySystemPromptHooks(prompt: string, input: LLMInput): string {
  let current = prompt;
  for (const hook of promptHooks) {
    if (hook.transformSystemPrompt) {
      current = hook.transformSystemPrompt(current, input);
    }
  }
  return current;
}

export function applyUserPromptHooks(prompt: string, input: LLMInput): string {
  let current = prompt;
  for (const hook of promptHooks) {
    if (hook.transformUserPrompt) {
      current = hook.transformUserPrompt(current, input);
    }
  }
  return current;
}

