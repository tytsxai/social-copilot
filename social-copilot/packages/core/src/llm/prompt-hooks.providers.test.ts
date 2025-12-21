import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMInput } from '../types';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { DeepSeekProvider } from './provider';
import { PromptHookRegistry, clearPromptHooks, registerPromptHook } from './prompt-hooks';

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
  vi.restoreAllMocks();
});

describe('prompt-hooks (providers)', () => {
  it('Provider uses instance registry hooks when provided (not global)', async () => {
    registerPromptHook({
      name: 'global',
      transformSystemPrompt: (p) => `${p}\n<G_SYS>`,
      transformUserPrompt: (p) => `${p}\n<G_USR>`,
    });

    const registry = new PromptHookRegistry();
    registry.register({
      name: 'instance',
      transformSystemPrompt: (p) => `${p}\n<I_SYS>`,
      transformUserPrompt: (p) => `${p}\n<I_USR>`,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify([{ style: 'casual', text: 'ok' }]) } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const provider = new OpenAIProvider({ apiKey: 'test-key', registry });
    await provider.generateReply(input);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].content).toContain('<I_SYS>');
    expect(body.messages[1].content).toContain('<I_USR>');
    expect(body.messages[0].content).not.toContain('<G_SYS>');
    expect(body.messages[1].content).not.toContain('<G_USR>');
  });

  it('OpenAIProvider applies system and user prompt hooks', async () => {
    registerPromptHook({
      name: 'mark',
      transformSystemPrompt: (p) => `${p}\n<SYS_HOOK>`,
      transformUserPrompt: (p) => `${p}\n<USR_HOOK>`,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify([{ style: 'casual', text: 'ok' }]) } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await provider.generateReply(input);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('<SYS_HOOK>');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('<USR_HOOK>');
  });

  it('DeepSeekProvider applies system and user prompt hooks', async () => {
    registerPromptHook({
      name: 'mark',
      transformSystemPrompt: (p) => `${p}\n<SYS_HOOK>`,
      transformUserPrompt: (p) => `${p}\n<USR_HOOK>`,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify([{ style: 'casual', text: 'ok' }]) } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const provider = new DeepSeekProvider({ apiKey: 'test-key' });
    await provider.generateReply(input);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('<SYS_HOOK>');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('<USR_HOOK>');
  });

  it('ClaudeProvider applies system and user prompt hooks', async () => {
    registerPromptHook({
      name: 'mark',
      transformSystemPrompt: (p) => `${p}\n<SYS_HOOK>`,
      transformUserPrompt: (p) => `${p}\n<USR_HOOK>`,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { text: JSON.stringify([{ style: 'casual', text: 'ok' }]) },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const provider = new ClaudeProvider({ apiKey: 'test-key' });
    await provider.generateReply(input);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.system).toContain('<SYS_HOOK>');
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('<USR_HOOK>');
  });
});
