import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMInput } from '../types';
import { PromptHookRegistry, applySystemPromptHooks, applyUserPromptHooks, clearPromptHooks, registerPromptHook } from './prompt-hooks';

const input: LLMInput = {
  context: {
    contactKey: {
      platform: 'web',
      app: 'telegram',
      conversationId: 'c1',
      peerId: 'p1',
      isGroup: false,
    },
    recentMessages: [],
    currentMessage: {
      id: 'm1',
      contactKey: {
        platform: 'web',
        app: 'telegram',
        conversationId: 'c1',
        peerId: 'p1',
        isGroup: false,
      },
      direction: 'incoming',
      senderName: 'Alice',
      text: 'hi',
      timestamp: 0,
    },
  },
  styles: ['casual'],
  language: 'zh',
};

afterEach(() => {
  clearPromptHooks();
});

const withDebugEnabled = (fn: () => void): void => {
  const globalRef = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const env = globalRef.process?.env ?? {};
  const previous = env.DEBUG;
  env.DEBUG = '1';
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete env.DEBUG;
    } else {
      env.DEBUG = previous;
    }
  }
};

describe('prompt-hooks', () => {
  it('register validates hook shape', () => {
    const r = new PromptHookRegistry();
    expect(() => r.register(undefined as any)).toThrow(/hook must be an object/i);
    expect(() => r.register({ name: '' } as any)).toThrow(/hook\.name must be a non-empty string/i);
    expect(() => r.register({ name: 'x', transformSystemPrompt: 'nope' } as any)).toThrow(/transformSystemPrompt must be a function/i);
    expect(() => r.register({ name: 'x', transformUserPrompt: 123 } as any)).toThrow(/transformUserPrompt must be a function/i);
  });

  it('getAll returns a shallow copy', () => {
    const r = new PromptHookRegistry();
    r.register({ name: 'a', transformSystemPrompt: (p) => p });
    const hooks = r.getAll() as any[];
    hooks.push({ name: 'b', transformSystemPrompt: (p: string) => `${p}-B` });
    expect(r.applySystemHooks('S', input)).toBe('S');
  });

  it('PromptHookRegistry isolates hook state per instance', () => {
    const r1 = new PromptHookRegistry();
    const r2 = new PromptHookRegistry();

    r1.register({
      name: 'r1',
      transformSystemPrompt: (p) => `${p}-R1`,
      transformUserPrompt: (p) => `${p}-r1`,
    });
    r2.register({
      name: 'r2',
      transformSystemPrompt: (p) => `${p}-R2`,
      transformUserPrompt: (p) => `${p}-r2`,
    });

    expect(r1.applySystemHooks('S', input)).toBe('S-R1');
    expect(r2.applySystemHooks('S', input)).toBe('S-R2');
    expect(r1.applyUserHooks('U', input)).toBe('U-r1');
    expect(r2.applyUserHooks('U', input)).toBe('U-r2');
  });

  it('applies system/user transforms in order', () => {
    registerPromptHook({
      name: 'a',
      transformSystemPrompt: (p) => `${p}-A`,
      transformUserPrompt: (p) => `${p}-a`,
    });
    registerPromptHook({
      name: 'b',
      transformSystemPrompt: (p) => `${p}-B`,
      transformUserPrompt: (p) => `${p}-b`,
    });

    expect(applySystemPromptHooks('S', input)).toBe('S-A-B');
    expect(applyUserPromptHooks('U', input)).toBe('U-a-b');
  });

  it('does not throw if a hook throws (system/user)', () => {
    withDebugEnabled(() => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registerPromptHook({
        name: 'boom',
        transformSystemPrompt: () => {
          throw new Error('system-fail');
        },
        transformUserPrompt: () => {
          throw new Error('user-fail');
        },
      });

      expect(applySystemPromptHooks('S', input)).toBe('S');
      expect(applyUserPromptHooks('U', input)).toBe('U');
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.every((m) => m.includes('prompt hook "boom"'))).toBe(true);
      expect(messages.some((m) => m.includes('system-fail'))).toBe(true);
      expect(messages.some((m) => m.includes('user-fail'))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  it('continues applying other hooks when one fails', () => {
    withDebugEnabled(() => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registerPromptHook({
        name: 'a',
        transformSystemPrompt: (p) => `${p}-A`,
        transformUserPrompt: (p) => `${p}-a`,
      });
      registerPromptHook({
        name: 'boom',
        transformSystemPrompt: () => {
          throw new Error('nope');
        },
        transformUserPrompt: () => {
          throw new Error('nope');
        },
      });
      registerPromptHook({
        name: 'b',
        transformSystemPrompt: (p) => `${p}-B`,
        transformUserPrompt: (p) => `${p}-b`,
      });

      expect(applySystemPromptHooks('S', input)).toBe('S-A-B');
      expect(applyUserPromptHooks('U', input)).toBe('U-a-b');
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.every((m) => m.includes('prompt hook "boom"'))).toBe(true);
      expect(messages.some((m) => m.includes('nope'))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  it('skips hook output when return type is not string', () => {
    withDebugEnabled(() => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registerPromptHook({
        name: 'bad',
        transformSystemPrompt: () => 123 as any,
        transformUserPrompt: () => ({ nope: true } as any),
      });
      registerPromptHook({
        name: 'good',
        transformSystemPrompt: (p) => `${p}-OK`,
        transformUserPrompt: (p) => `${p}-ok`,
      });

      expect(applySystemPromptHooks('S', input)).toBe('S-OK');
      expect(applyUserPromptHooks('U', input)).toBe('U-ok');
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('returned non-string'))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  it('truncates too-long hook output', () => {
    withDebugEnabled(() => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const veryLong = 'x'.repeat(120_000);
      registerPromptHook({
        name: 'long',
        transformSystemPrompt: () => veryLong,
        transformUserPrompt: () => veryLong,
      });

      expect(applySystemPromptHooks('S', input).length).toBe(100_000);
      expect(applyUserPromptHooks('U', input).length).toBe(100_000);
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('too-long string'))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
