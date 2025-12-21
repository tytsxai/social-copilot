import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';
import { parseReplyContent, ReplyParseError } from './reply-validation';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { PromptHookRegistry } from './prompt-hooks';
import { applySystemPromptHooks, applyUserPromptHooks } from './prompt-hooks';
import { redactSecrets } from '../utils/redact';
import { normalizeBaseUrl } from './normalize-base-url';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

/**
 * OpenAI API Provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private registry?: PromptHookRegistry;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string; registry?: PromptHookRegistry }) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.openai.com');
    this.model = config.model || 'gpt-5.2-chat-latest';
    this.registry = config.registry;
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const task = input.task ?? 'reply';
    const startTime = Date.now();
    const maxTokens = Math.max(1, Math.min(input.maxLength ?? 1000, 2000));
    const prompt = buildUserPrompt(task, input);
    const systemPrompt = buildSystemPrompt(task, input);

    const finalSystemPrompt = this.registry
      ? this.registry.applySystemHooks(systemPrompt, input)
      : applySystemPromptHooks(systemPrompt, input);
    const finalPrompt = this.registry
      ? this.registry.applyUserHooks(prompt, input)
      : applyUserPromptHooks(prompt, input);

    const response = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: finalPrompt },
        ],
        temperature: 0.8,
        max_tokens: maxTokens,
      }),
      timeoutMs: 20_000,
      retry: { retries: 2 },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = redactSecrets(errorData.error?.message || `status ${response.status}`);
      throw new Error(`OpenAI API error: ${response.status} ${errorMessage}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const candidates = task === 'reply'
      ? this.parseReplyResponse(content, input.styles)
      : this.parseNonReplyResponse(content, input.styles, task);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  private parseReplyResponse(content: string, styles: ReplyStyle[]): ReplyCandidate[] {
    try {
      return parseReplyContent(content, styles, 'reply');
    } catch (err) {
      if (err instanceof ReplyParseError) {
        throw err;
      }
      throw new ReplyParseError((err as Error).message);
    }
  }

  private parseNonReplyResponse(content: string, styles: ReplyStyle[], task: Exclude<LLMInput['task'], 'reply'>): ReplyCandidate[] {
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
