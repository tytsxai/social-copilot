/**
 * Result Type Refactoring Examples
 *
 * This file demonstrates how to migrate from try-catch to Result type.
 * These are example implementations showing the before/after comparison.
 */

import type { LLMInput, LLMOutput, ReplyCandidate, ReplyStyle } from '../src/types';
import { parseReplyContent, ReplyParseError } from '../src/llm/reply-validation';
import { fetchWithTimeout } from '../src/llm/fetch-with-timeout';
import { redactSecrets } from '../src/utils/redact';
import { ok, err, fromPromise, fromThrowable, mapErr, type Result } from '../src/utils/result';

/**
 * EXAMPLE 1: Simple try-catch to Result
 *
 * Before: parseReplyResponse with try-catch
 */
export function parseReplyResponse_BEFORE(
  content: string,
  styles: ReplyStyle[]
): ReplyCandidate[] {
  try {
    return parseReplyContent(content, styles, 'reply');
  } catch (err) {
    if (err instanceof ReplyParseError) {
      throw err;
    }
    throw new ReplyParseError((err as Error).message);
  }
}

/**
 * After: parseReplyResponse with Result type
 *
 * Benefits:
 * - Explicit error handling in type signature
 * - No hidden control flow (no throw)
 * - Composable with other Result operations
 */
export function parseReplyResponse_AFTER(
  content: string,
  styles: ReplyStyle[]
): Result<ReplyCandidate[], ReplyParseError> {
  const safeParse = fromThrowable(parseReplyContent);
  const result = safeParse(content, styles, 'reply');

  return mapErr(result, err => {
    return err instanceof ReplyParseError
      ? err
      : new ReplyParseError(err.message);
  });
}

/**
 * EXAMPLE 2: Async API call with error handling
 *
 * Before: generateReply with implicit error handling
 */
export async function generateReply_BEFORE(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: LLMInput
): Promise<LLMOutput> {
  const startTime = Date.now();

  // This can throw - hidden in type signature
  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      temperature: 0.8,
      max_tokens: 1000,
    }),
    timeoutMs: 20_000,
    retry: { retries: 2 },
  });

  // This can throw - hidden in type signature
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = redactSecrets(errorData.error?.message || `status ${response.status}`);
    throw new Error(`OpenAI API error: ${response.status} ${errorMessage}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // This can throw - hidden in type signature
  const candidates = parseReplyResponse_BEFORE(content, input.styles);

  return {
    candidates,
    model,
    latency: Date.now() - startTime,
    raw: data,
  };
}

/**
 * After: generateReply with Result type
 *
 * Benefits:
 * - Explicit error handling in return type
 * - Caller knows this can fail
 * - Composable error handling
 * - No try-catch nesting
 */
export async function generateReply_AFTER(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: LLMInput
): Promise<Result<LLMOutput, Error>> {
  const startTime = Date.now();

  // Wrap fetch in Result
  const fetchResult = await fromPromise(
    fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' },
        ],
        temperature: 0.8,
        max_tokens: 1000,
      }),
      timeoutMs: 20_000,
      retry: { retries: 2 },
    })
  );

  // Early return on fetch error
  if (!fetchResult.ok) {
    return err(fetchResult.error);
  }

  const response = fetchResult.value;

  // Check response status
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = redactSecrets(errorData.error?.message || `status ${response.status}`);
    return err(new Error(`OpenAI API error: ${response.status} ${errorMessage}`));
  }

  // Parse JSON
  const jsonResult = await fromPromise(response.json());
  if (!jsonResult.ok) {
    return err(new Error(`Failed to parse response: ${jsonResult.error.message}`));
  }

  const data = jsonResult.value;
  const content = data.choices?.[0]?.message?.content || '';

  // Parse reply content
  const parseResult = parseReplyResponse_AFTER(content, input.styles);
  if (!parseResult.ok) {
    return err(parseResult.error);
  }

  return ok({
    candidates: parseResult.value,
    model,
    latency: Date.now() - startTime,
    raw: data,
  });
}

/**
 * EXAMPLE 3: Functional composition with Result
 *
 * Before: Nested try-catch blocks
 */
export async function processUserInput_BEFORE(input: string): Promise<number> {
  try {
    const parsed = JSON.parse(input);
    try {
      const validated = validateConfig(parsed);
      try {
        const result = await processConfig(validated);
        return result;
      } catch (err) {
        throw new Error(`Process failed: ${(err as Error).message}`);
      }
    } catch (err) {
      throw new Error(`Validation failed: ${(err as Error).message}`);
    }
  } catch (err) {
    throw new Error(`Parse failed: ${(err as Error).message}`);
  }
}

function validateConfig(config: unknown): { value: number } {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Invalid config');
  }
  if (!('value' in config) || typeof config.value !== 'number') {
    throw new Error('Missing value');
  }
  return config as { value: number };
}

async function processConfig(config: { value: number }): Promise<number> {
  if (config.value < 0) {
    throw new Error('Negative value');
  }
  return config.value * 2;
}

/**
 * After: Functional composition with Result
 *
 * Benefits:
 * - No nesting
 * - Clear error propagation
 * - Composable transformations
 * - Type-safe error handling
 */
export async function processUserInput_AFTER(input: string): Promise<Result<number, string>> {
  const safeParse = fromThrowable(JSON.parse);
  const safeValidate = fromThrowable(validateConfig);
  const safeProcess = async (config: { value: number }): Promise<Result<number, string>> => {
    const result = await fromPromise(processConfig(config));
    return mapErr(result, e => `Process failed: ${e.message}`);
  };

  // Functional composition - no nesting!
  const parseResult = safeParse(input);
  if (!parseResult.ok) {
    return err(`Parse failed: ${parseResult.error.message}`);
  }

  const validateResult = safeValidate(parseResult.value);
  if (!validateResult.ok) {
    return err(`Validation failed: ${validateResult.error.message}`);
  }

  return safeProcess(validateResult.value);
}

/**
 * EXAMPLE 4: Error recovery with Result
 *
 * Before: Multiple try-catch for fallback logic
 */
export async function fetchWithFallback_BEFORE(
  primaryUrl: string,
  fallbackUrl: string
): Promise<string> {
  try {
    const response = await fetch(primaryUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (primaryError) {
    console.warn('Primary failed, trying fallback:', primaryError);
    try {
      const response = await fetch(fallbackUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (fallbackError) {
      throw new Error(
        `Both failed: ${(primaryError as Error).message}, ${(fallbackError as Error).message}`
      );
    }
  }
}

/**
 * After: Error recovery with Result
 *
 * Benefits:
 * - Clear fallback logic
 * - No nested try-catch
 * - Explicit error accumulation
 */
export async function fetchWithFallback_AFTER(
  primaryUrl: string,
  fallbackUrl: string
): Promise<Result<string, string>> {
  const fetchUrl = async (url: string): Promise<Result<string, string>> => {
    const result = await fromPromise(fetch(url));
    if (!result.ok) {
      return err(`Fetch failed: ${result.error.message}`);
    }

    if (!result.value.ok) {
      return err(`HTTP ${result.value.status}`);
    }

    const textResult = await fromPromise(result.value.text());
    return mapErr(textResult, e => `Parse failed: ${e.message}`);
  };

  // Try primary
  const primaryResult = await fetchUrl(primaryUrl);
  if (primaryResult.ok) {
    return primaryResult;
  }

  // Try fallback
  const fallbackResult = await fetchUrl(fallbackUrl);
  if (fallbackResult.ok) {
    return fallbackResult;
  }

  // Both failed
  return err(`Both failed: ${primaryResult.error}, ${fallbackResult.error}`);
}

/**
 * EXAMPLE 5: Validation pipeline with Result
 *
 * Before: Throwing validators
 */
export function validateUser_BEFORE(data: unknown): { email: string; age: number } {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid data');
  }

  if (!('email' in data) || typeof data.email !== 'string') {
    throw new Error('Invalid email');
  }

  if (!data.email.includes('@')) {
    throw new Error('Email must contain @');
  }

  if (!('age' in data) || typeof data.age !== 'number') {
    throw new Error('Invalid age');
  }

  if (data.age < 0 || data.age > 150) {
    throw new Error('Age out of range');
  }

  return { email: data.email, age: data.age };
}

/**
 * After: Validation pipeline with Result
 *
 * Benefits:
 * - Composable validators
 * - Clear error messages
 * - Type-safe transformations
 */
export function validateUser_AFTER(data: unknown): Result<{ email: string; age: number }, string> {
  // Validate object
  if (typeof data !== 'object' || data === null) {
    return err('Invalid data');
  }

  // Validate email
  if (!('email' in data) || typeof data.email !== 'string') {
    return err('Invalid email');
  }

  if (!data.email.includes('@')) {
    return err('Email must contain @');
  }

  // Validate age
  if (!('age' in data) || typeof data.age !== 'number') {
    return err('Invalid age');
  }

  if (data.age < 0 || data.age > 150) {
    return err('Age out of range');
  }

  return ok({ email: data.email, age: data.age });
}

/**
 * Usage comparison
 */
export async function usageExample() {
  // BEFORE: Must use try-catch
  try {
    const output = await generateReply_BEFORE('https://api.openai.com', 'key', 'gpt-4', {
      context: {
        contactKey: {
          platform: 'web',
          app: 'telegram',
          accountId: 'acc',
          conversationId: 'conv',
          peerId: 'peer',
          isGroup: false,
        },
        recentMessages: [],
        currentMessage: {
          id: '1',
          contactKey: {
            platform: 'web',
            app: 'telegram',
            accountId: 'acc',
            conversationId: 'conv',
            peerId: 'peer',
            isGroup: false,
          },
          direction: 'incoming',
          senderName: 'Alice',
          text: 'Hello',
          timestamp: Date.now(),
        },
      },
      styles: ['casual'],
      language: 'zh',
    });
    console.log('Success:', output);
  } catch (error) {
    console.error('Failed:', error);
  }

  // AFTER: Explicit error handling
  const result = await generateReply_AFTER('https://api.openai.com', 'key', 'gpt-4', {
    context: {
      contactKey: {
        platform: 'web',
        app: 'telegram',
        accountId: 'acc',
        conversationId: 'conv',
        peerId: 'peer',
        isGroup: false,
      },
      recentMessages: [],
      currentMessage: {
        id: '1',
        contactKey: {
          platform: 'web',
          app: 'telegram',
          accountId: 'acc',
          conversationId: 'conv',
          peerId: 'peer',
          isGroup: false,
        },
        direction: 'incoming',
        senderName: 'Alice',
        text: 'Hello',
        timestamp: Date.now(),
      },
    },
    styles: ['casual'],
    language: 'zh',
  });

  if (result.ok) {
    console.log('Success:', result.value);
  } else {
    console.error('Failed:', result.error);
  }
}
