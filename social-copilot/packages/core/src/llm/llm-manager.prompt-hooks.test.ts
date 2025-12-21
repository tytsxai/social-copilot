import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMInput } from '../types';
import { LLMManager } from './llm-manager';
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

describe('LLMManager prompt hook registry', () => {
  it('uses the provided registry (not global) when creating providers', async () => {
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

    const manager = new LLMManager(
      { primary: { provider: 'openai', apiKey: 'test-key' } },
      {},
      registry
    );
    await manager.generateReply(input);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].content).toContain('<I_SYS>');
    expect(body.messages[1].content).toContain('<I_USR>');
    expect(body.messages[0].content).not.toContain('<G_SYS>');
    expect(body.messages[1].content).not.toContain('<G_USR>');
  });

  it('isolates hook state across multiple LLMManager instances', async () => {
    const r1 = new PromptHookRegistry();
    r1.register({
      name: 'r1',
      transformSystemPrompt: (p) => `${p}\n<R1_SYS>`,
      transformUserPrompt: (p) => `${p}\n<R1_USR>`,
    });

    const r2 = new PromptHookRegistry();
    r2.register({
      name: 'r2',
      transformSystemPrompt: (p) => `${p}\n<R2_SYS>`,
      transformUserPrompt: (p) => `${p}\n<R2_USR>`,
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

    const manager1 = new LLMManager({ primary: { provider: 'openai', apiKey: 'test-key' } }, {}, r1);
    const manager2 = new LLMManager({ primary: { provider: 'openai', apiKey: 'test-key' } }, {}, r2);

    await manager1.generateReply(input);
    await manager2.generateReply(input);

    const bodies = fetchSpy.mock.calls.map((call) => {
      const [, options] = call;
      return JSON.parse((options as RequestInit).body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
    });

    expect(bodies[0].messages[0].content).toContain('<R1_SYS>');
    expect(bodies[0].messages[1].content).toContain('<R1_USR>');
    expect(bodies[0].messages[0].content).not.toContain('<R2_SYS>');
    expect(bodies[0].messages[1].content).not.toContain('<R2_USR>');

    expect(bodies[1].messages[0].content).toContain('<R2_SYS>');
    expect(bodies[1].messages[1].content).toContain('<R2_USR>');
    expect(bodies[1].messages[0].content).not.toContain('<R1_SYS>');
    expect(bodies[1].messages[1].content).not.toContain('<R1_USR>');
  });
});

