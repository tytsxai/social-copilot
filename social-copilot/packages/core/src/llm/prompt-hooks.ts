import type { LLMInput } from '../types';

export interface PromptHook {
  name: string;
  transformSystemPrompt?: (prompt: string, input: LLMInput) => string;
  transformUserPrompt?: (prompt: string, input: LLMInput) => string;
}

export class PromptHookRegistry {
  private readonly hooks: PromptHook[] = [];

  register(hook: PromptHook): void {
    this.hooks.push(hook);
  }

  clear(): void {
    this.hooks.length = 0;
  }

  getAll(): readonly PromptHook[] {
    return this.hooks;
  }

  applySystemHooks(prompt: string, input: LLMInput): string {
    let current = prompt;
    for (const hook of this.hooks) {
      if (hook.transformSystemPrompt) {
        try {
          current = hook.transformSystemPrompt(current, input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`prompt hook "${hook.name}" transformSystemPrompt failed: ${message}`);
        }
      }
    }
    return current;
  }

  applyUserHooks(prompt: string, input: LLMInput): string {
    let current = prompt;
    for (const hook of this.hooks) {
      if (hook.transformUserPrompt) {
        try {
          current = hook.transformUserPrompt(current, input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`prompt hook "${hook.name}" transformUserPrompt failed: ${message}`);
        }
      }
    }
    return current;
  }
}

const defaultRegistry = new PromptHookRegistry();

export function registerPromptHook(hook: PromptHook): void {
  defaultRegistry.register(hook);
}

export function clearPromptHooks(): void {
  defaultRegistry.clear();
}

export function getPromptHooks(): readonly PromptHook[] {
  return defaultRegistry.getAll();
}

export function applySystemPromptHooks(prompt: string, input: LLMInput): string {
  return defaultRegistry.applySystemHooks(prompt, input);
}

export function applyUserPromptHooks(prompt: string, input: LLMInput): string {
  return defaultRegistry.applyUserHooks(prompt, input);
}

export function getDefaultPromptHookRegistry(): PromptHookRegistry {
  return defaultRegistry;
}
