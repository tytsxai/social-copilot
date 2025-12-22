import type { LLMInput } from '../types';
import { isDebugEnabled } from '../utils/debug';

export interface PromptHook {
  name: string;
  transformSystemPrompt?: (prompt: string, input: LLMInput) => string;
  transformUserPrompt?: (prompt: string, input: LLMInput) => string;
}

const MAX_PROMPT_LENGTH = 100_000;

const debugWarn = (message: string): void => {
  if (isDebugEnabled()) {
    console.warn(message);
  }
};

export class PromptHookRegistry {
  private readonly hooks: PromptHook[] = [];

  register(hook: PromptHook): void {
    if (!hook || typeof hook !== 'object') {
      throw new TypeError('hook must be an object');
    }
    if (typeof hook.name !== 'string' || hook.name.trim().length === 0) {
      throw new TypeError('hook.name must be a non-empty string');
    }
    if (hook.transformSystemPrompt !== undefined && typeof hook.transformSystemPrompt !== 'function') {
      throw new TypeError('hook.transformSystemPrompt must be a function if provided');
    }
    if (hook.transformUserPrompt !== undefined && typeof hook.transformUserPrompt !== 'function') {
      throw new TypeError('hook.transformUserPrompt must be a function if provided');
    }
    this.hooks.push(hook);
  }

  clear(): void {
    this.hooks.length = 0;
  }

  getAll(): readonly PromptHook[] {
    return [...this.hooks];
  }

  applySystemHooks(prompt: string, input: LLMInput): string {
    let current = prompt;
    for (const hook of this.hooks) {
      if (hook.transformSystemPrompt) {
        try {
          const next = hook.transformSystemPrompt(current, input);
          if (typeof next !== 'string') {
            debugWarn(`prompt hook "${hook.name}" transformSystemPrompt returned non-string`);
            continue;
          }
          if (next.length > MAX_PROMPT_LENGTH) {
            debugWarn(
              `prompt hook "${hook.name}" transformSystemPrompt returned too-long string (${next.length}); truncating to ${MAX_PROMPT_LENGTH}`,
            );
            current = next.slice(0, MAX_PROMPT_LENGTH);
            continue;
          }
          current = next;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          debugWarn(`prompt hook "${hook.name}" transformSystemPrompt failed: ${message}`);
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
          const next = hook.transformUserPrompt(current, input);
          if (typeof next !== 'string') {
            debugWarn(`prompt hook "${hook.name}" transformUserPrompt returned non-string`);
            continue;
          }
          if (next.length > MAX_PROMPT_LENGTH) {
            debugWarn(
              `prompt hook "${hook.name}" transformUserPrompt returned too-long string (${next.length}); truncating to ${MAX_PROMPT_LENGTH}`,
            );
            current = next.slice(0, MAX_PROMPT_LENGTH);
            continue;
          }
          current = next;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          debugWarn(`prompt hook "${hook.name}" transformUserPrompt failed: ${message}`);
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
