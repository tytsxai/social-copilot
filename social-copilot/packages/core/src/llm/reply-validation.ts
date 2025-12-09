import type { ReplyCandidate, ReplyStyle, LLMInput } from '../types';

/** Error used to signal invalid or malformed reply payloads. */
export class ReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplyParseError';
  }
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Attempt to extract the first JSON block (array or object) from a text blob.
 * Supports bracket-balanced scan to avoid greedy regex mistakes.
 */
export function extractJsonBlock(text: string): string | null {
  const candidates = [
    { start: text.indexOf('['), startChar: '[', endChar: ']' },
    { start: text.indexOf('{'), startChar: '{', endChar: '}' },
  ]
    .filter((item) => item.start !== -1)
    .sort((a, b) => a.start - b.start);

  for (const { start, startChar, endChar } of candidates) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === startChar) depth++;
      else if (ch === endChar) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

export function validateReplyCandidates(output: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(output)) {
    errors.push('candidates must be an array');
    return { ok: false, errors };
  }
  if (output.length === 0) {
    errors.push('candidates must not be empty');
  }

  output.forEach((c, i) => {
    if (typeof c !== 'object' || c === null) {
      errors.push(`candidates[${i}] must be an object`);
      return;
    }
    const style = (c as { style?: unknown }).style;
    if (typeof style !== 'string' || style.trim() === '') {
      errors.push(`candidates[${i}].style must be a non-empty string`);
    }
    const text = (c as { text?: unknown }).text;
    if (typeof text !== 'string' || text.trim() === '') {
      errors.push(`candidates[${i}].text must be a non-empty string`);
    }
    if ('meta' in (c as Record<string, unknown>)) {
      const meta = (c as { meta?: unknown }).meta;
      if (typeof meta !== 'object' || meta === null) {
        errors.push(`candidates[${i}].meta must be an object when present`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

export function parseReplyContent(content: string, styles: ReplyStyle[], task?: LLMInput['task']): ReplyCandidate[] {
  // Profile extraction keeps prior loose object parsing to avoid breaking flow
  if ((task ?? 'reply') === 'profile_extraction') {
    const json = extractJsonBlock(content) ?? content.trim();
    return [
      {
        style: styles[0] || 'rational',
        text: json,
        confidence: 0.8,
      },
    ];
  }

  // Prefer strict parse first; only fall back to extracted block when the response wraps JSON
  const parseArray = (): any[] => {
    try {
      const direct = JSON.parse(content);
      if (Array.isArray(direct)) return direct;
    } catch {/* ignore and fall back */}

    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) {
      throw new ReplyParseError('No JSON array found in LLM response');
    }

    const parsed = JSON.parse(jsonBlock);
    if (!Array.isArray(parsed)) {
      throw new ReplyParseError('Top-level JSON is not an array');
    }
    return parsed;
  };

  const parsed = parseArray();

  const candidates = parsed.map((item: any, idx: number) => ({
    style: typeof item?.style === 'string' ? item.style : styles[idx] || styles[0] || 'casual',
    text: typeof item?.text === 'string' ? item.text : String(item?.text ?? ''),
    confidence: 0.8,
  }));

  const validation = validateReplyCandidates(candidates);
  if (!validation.ok) {
    throw new ReplyParseError(`Invalid reply candidates: ${validation.errors.join('; ')}`);
  }

  return candidates;
}
