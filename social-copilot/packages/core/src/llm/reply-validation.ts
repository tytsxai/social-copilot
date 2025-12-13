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

const ALLOWED_REPLY_STYLES: ReplyStyle[] = ['humorous', 'caring', 'rational', 'casual', 'formal'];
const REPLY_STYLE_SET = new Set<ReplyStyle>(ALLOWED_REPLY_STYLES);

function normalizeReplyStyle(raw: unknown, fallback: ReplyStyle): ReplyStyle {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim();
  if (!s) return fallback;
  const lower = s.toLowerCase();

  // Exact match
  if (REPLY_STYLE_SET.has(lower as ReplyStyle)) {
    return lower as ReplyStyle;
  }

  // Common aliases (EN)
  if (lower === 'humor' || lower === 'fun' || lower === 'joke') return 'humorous';
  if (lower === 'care' || lower === 'empathetic' || lower === 'empathy') return 'caring';
  if (lower === 'reason' || lower === 'rationality' || lower === 'advice' || lower === 'solution') return 'rational';
  if (lower === 'chill' || lower === 'friendly') return 'casual';
  if (lower === 'polite' || lower === 'professional') return 'formal';

  // Common aliases (ZH)
  if (s.includes('幽默') || s.includes('搞笑') || s.includes('玩笑')) return 'humorous';
  if (s.includes('关心') || s.includes('体贴') || s.includes('安慰') || s.includes('共情')) return 'caring';
  if (s.includes('理性') || s.includes('客观') || s.includes('建议') || s.includes('方案') || s.includes('解决')) return 'rational';
  if (s.includes('随意') || s.includes('轻松') || s.includes('日常')) return 'casual';
  if (s.includes('正式') || s.includes('礼貌') || s.includes('职业') || s.includes('工作')) return 'formal';

  return fallback;
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
    } else if (!REPLY_STYLE_SET.has(style.trim().toLowerCase() as ReplyStyle)) {
      errors.push(`candidates[${i}].style must be one of: ${ALLOWED_REPLY_STYLES.join(', ')}`);
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
  const effectiveTask = task ?? 'reply';
  if (effectiveTask === 'profile_extraction' || effectiveTask === 'memory_extraction') {
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
  const parseArray = (): unknown[] => {
    try {
      const direct = JSON.parse(content) as unknown;
      if (Array.isArray(direct)) return direct as unknown[];
    } catch {/* ignore and fall back */}

    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) {
      throw new ReplyParseError('No JSON array found in LLM response');
    }

    const parsed = JSON.parse(jsonBlock) as unknown;
    if (!Array.isArray(parsed)) {
      throw new ReplyParseError('Top-level JSON is not an array');
    }
    return parsed as unknown[];
  };

  const parsed = parseArray();

  const candidates = parsed.map((item: unknown, idx: number) => {
    const fallbackStyle = styles[idx] || styles[0] || 'casual';

    // Some models may return a bare string array; tolerate it by treating the string as text.
    if (typeof item === 'string') {
      return { style: fallbackStyle, text: item, confidence: 0.8 };
    }

    if (typeof item !== 'object' || item === null) {
      throw new ReplyParseError(`candidates[${idx}] must be an object or string`);
    }

    const record = item as Record<string, unknown>;
    const text = record.text;
    if (typeof text !== 'string') {
      throw new ReplyParseError(`candidates[${idx}].text must be a string`);
    }

    return {
      style: normalizeReplyStyle(record.style, fallbackStyle),
      text,
      confidence: 0.8,
    };
  });

  const validation = validateReplyCandidates(candidates);
  if (!validation.ok) {
    throw new ReplyParseError(`Invalid reply candidates: ${validation.errors.join('; ')}`);
  }

  return candidates;
}
