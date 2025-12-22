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

function extractOpenAIContent(data: unknown): string {
  if (!isPlainObject(data)) {
    throw new Error(`Invalid OpenAI response structure: expected object, got ${formatType(data)}`);
  }

  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Invalid OpenAI response structure: missing non-empty choices array');
  }

  const firstChoice = choices[0];
  if (!isPlainObject(firstChoice)) {
    throw new Error(`Invalid OpenAI response structure: choices[0] expected object, got ${formatType(firstChoice)}`);
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (!isPlainObject(message)) {
    throw new Error(`Invalid OpenAI response structure: choices[0].message expected object, got ${formatType(message)}`);
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string') {
    throw new Error(
      `Invalid OpenAI response structure: choices[0].message.content expected string, got ${formatType(content)}`
    );
  }

  return content;
}

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  allowInsecureHttp?: boolean;
  allowPrivateHosts?: boolean;
  registry?: PromptHookRegistry;
}

/**
 * OpenAI API Provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private registry?: PromptHookRegistry;

  constructor(config: OpenAIProviderConfig) {
    if (!OpenAIProvider.validateApiKey(config.apiKey)) {
      throw new Error('Invalid OpenAI apiKey');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.openai.com', {
      allowInsecureHttp: config.allowInsecureHttp,
      allowPrivateHosts: config.allowPrivateHosts,
    });
    this.model = config.model || 'gpt-5.2-chat-latest';
    this.registry = config.registry;
  }

  static validateApiKey(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') return false;
    const trimmed = apiKey.trim();
    if (!trimmed) return false;
    if (/\s/.test(trimmed)) return false;
    // Common OpenAI keys start with "sk-"; accept any non-empty token-like key to avoid false negatives.
    return true;
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
        temperature,
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

    const data: unknown = await response.json();
    const content = extractOpenAIContent(data);
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
