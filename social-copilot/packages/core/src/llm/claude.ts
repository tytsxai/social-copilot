import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';
import { parseReplyContent, ReplyParseError } from './reply-validation';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { PromptHookRegistry } from './prompt-hooks';
import { applySystemPromptHooks, applyUserPromptHooks } from './prompt-hooks';
import { redactSecrets } from '../utils/redact';
import { normalizeBaseUrl } from './normalize-base-url';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function extractClaudeContent(data: unknown): string {
  if (!isPlainObject(data)) {
    throw new Error(`Invalid Claude response structure: expected object, got ${formatType(data)}`);
  }

  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('Invalid Claude response structure: missing non-empty content array');
  }

  const first = content[0];
  if (!isPlainObject(first)) {
    throw new Error(`Invalid Claude response structure: content[0] expected object, got ${formatType(first)}`);
  }

  const text = (first as { text?: unknown }).text;
  if (typeof text !== 'string') {
    throw new Error(`Invalid Claude response structure: content[0].text expected string, got ${formatType(text)}`);
  }

  return text;
}

/**
 * Claude API Provider Configuration
 */
export interface ClaudeProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  allowInsecureHttp?: boolean;
  allowPrivateHosts?: boolean;
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
    if (!ClaudeProvider.validateApiKey(config.apiKey)) {
      throw new Error('Invalid Claude apiKey');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.anthropic.com', {
      allowInsecureHttp: config.allowInsecureHttp,
      allowPrivateHosts: config.allowPrivateHosts,
    });
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
    const trimmed = apiKey.trim();
    if (!trimmed) return false;
    return trimmed.startsWith('sk-ant-');
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
        temperature,
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

    const data: unknown = await response.json();
    const content = extractClaudeContent(data);
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
