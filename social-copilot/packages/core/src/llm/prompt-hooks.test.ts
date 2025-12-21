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

describe('prompt-hooks', () => {
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

  it('continues applying other hooks when one fails', () => {
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
