import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';
import { parseReplyContent, ReplyParseError } from './reply-validation';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { PromptHookRegistry } from './prompt-hooks';
import { applySystemPromptHooks, applyUserPromptHooks } from './prompt-hooks';
import { buildSystemPrompt, buildUserPrompt } from './prompts';
import { BUILTIN_API_URL, BUILTIN_MODEL } from './builtin-config';

export class BuiltinProvider implements LLMProvider {
  readonly name = 'builtin';
  private apiUrl: string;
  private model: string;
  private apiKey: string;
  private registry?: PromptHookRegistry;

  constructor(config: {
    apiKey: string;
    apiUrl?: string;
    model?: string;
    registry?: PromptHookRegistry;
  }) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error('Invalid builtin apiKey');
    }
    this.apiKey = config.apiKey.trim();
    this.apiUrl = config.apiUrl || BUILTIN_API_URL;
    this.model = config.model || BUILTIN_MODEL;
    this.registry = config.registry;
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const task = input.task ?? 'reply';
    const startTime = Date.now();
    const maxTokens = Math.max(1, Math.min(input.maxLength ?? 1000, 2000));
    const prompt = buildUserPrompt(task, input);
    const systemPrompt = buildSystemPrompt(task, input);
    const temperature = typeof input.temperature === 'number' ? input.temperature : 0.8;

    const finalSystemPrompt = this.registry
      ? this.registry.applySystemHooks(systemPrompt, input)
      : applySystemPromptHooks(systemPrompt, input);
    const finalPrompt = this.registry
      ? this.registry.applyUserHooks(prompt, input)
      : applyUserPromptHooks(prompt, input);

    const response = await fetchWithTimeout(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: finalPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      timeoutMs: 20_000,
      retry: { retries: 2 },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
      const errorMessage = errorData.error?.message || `status ${response.status}`;
      throw new Error(`Builtin API error: ${response.status} ${errorMessage}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const candidates = this.parseResponse(content, input.styles, task);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  private parseResponse(content: string, styles: ReplyStyle[], task?: LLMInput['task']): ReplyCandidate[] {
    try {
      return parseReplyContent(content, styles, task);
    } catch (err) {
      if (err instanceof ReplyParseError) {
        throw err;
      }
      throw new ReplyParseError((err as Error).message);
    }
  }
}
