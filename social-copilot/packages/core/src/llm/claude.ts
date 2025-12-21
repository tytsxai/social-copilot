import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';
import { parseReplyContent, ReplyParseError } from './reply-validation';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { PromptHookRegistry } from './prompt-hooks';
import { applySystemPromptHooks, applyUserPromptHooks } from './prompt-hooks';
import { redactSecrets } from '../utils/redact';
import { normalizeBaseUrl } from './normalize-base-url';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

/**
 * Claude API Provider Configuration
 */
export interface ClaudeProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  registry?: PromptHookRegistry;
}

/**
 * Claude API Provider
 *
 * Implements the LLMProvider interface for Anthropic's Claude API.
 * Uses the Messages API with anthropic-version header.
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private registry?: PromptHookRegistry;

  constructor(config: ClaudeProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.anthropic.com');
    this.model = config.model || 'claude-sonnet-4-5';
    this.registry = config.registry;
  }

  /**
   * Validates Claude API key format.
   * Claude API keys start with "sk-ant-" prefix.
   */
  static validateApiKey(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }
    return apiKey.startsWith('sk-ant-');
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

    const response = await fetchWithTimeout(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: finalSystemPrompt,
        messages: [
          { role: 'user', content: finalPrompt },
        ],
      }),
      timeoutMs: 20_000,
      retry: { retries: 2 },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const apiMessage = redactSecrets(
        typeof (errorData as { error?: { message?: unknown } } | undefined)?.error?.message === 'string'
          ? String((errorData as { error?: { message?: unknown } }).error!.message)
          : ''
      );
      const suffix = apiMessage ? ` ${apiMessage}` : '';
      throw new Error(`Claude API error: ${response.status}${suffix}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    const candidates = this.parseResponse(content, input.styles, task);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  parseResponse(content: string, styles: ReplyStyle[], task?: LLMInput['task']): ReplyCandidate[] {
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
