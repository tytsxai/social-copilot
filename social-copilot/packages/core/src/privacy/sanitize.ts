import type { ConversationContext, Message } from '../types';

export interface OutboundPrivacyOptions {
  /**
   * Max number of recent messages sent to the LLM (excluding currentMessage which is always included).
   * Defaults to 10.
   */
  maxRecentMessages?: number;
  /** Truncate each message text to at most N chars. Defaults to 500. */
  maxCharsPerMessage?: number;
  /** Truncate total text chars across the whole context. Defaults to 4000. */
  maxTotalChars?: number;
  /** Redact common PII patterns (email/phone/url). Defaults to true. */
  redactPii?: boolean;
  /** Replace senderName with generic labels. Defaults to true. */
  anonymizeSenderNames?: boolean;
}

const DEFAULTS: Required<OutboundPrivacyOptions> = {
  maxRecentMessages: 10,
  maxCharsPerMessage: 500,
  maxTotalChars: 4000,
  redactPii: true,
  anonymizeSenderNames: true,
};

function normalizeForPii(text: string): string {
  // Only normalize characters relevant to PII detection to avoid changing
  // unrelated punctuation (e.g. Chinese colon "：" should remain intact).
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, '+');
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;
    let add = code;
    if (doubleDigit) {
      add *= 2;
      if (add > 9) add -= 9;
    }
    sum += add;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function redactPii(text: string): string {
  let out = normalizeForPii(text);

  // URLs
  out = out.replace(
    /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/gi,
    '[URL]'
  );

  // Emails
  out = out.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[EMAIL]'
  );

  // Common API keys / tokens.
  out = out.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[API_KEY]');
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{10,}={0,2}\b/gi, 'Bearer [TOKEN]');
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[TOKEN]');

  // IP addresses (IPv4 and a pragmatic IPv6 matcher).
  out = out.replace(
    /(^|[^\w])((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))(?!\w)/g,
    (_match, prefix: string) => `${prefix}[IP]`
  );
  out = out.replace(
    /(^|[^\w])((?:(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}|::1))(?!\w)/gi,
    (_match, prefix: string) => `${prefix}[IP]`
  );

  // China Resident Identity Card Number (18 digits; checksum not validated here).
  out = out.replace(
    /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b/g,
    '[CN_ID]'
  );

  // Phone numbers (international + local), plus Chinese mobile numbers.
  out = out.replace(/\b1[3-9]\d{9}\b/g, '[PHONE]');
  out = out.replace(/(^|[^\w])([+()0-9][0-9()\s-]{4,}[0-9])(?!\w)/g, (match, prefix: string, candidate: string) => {
    const digitCount = (candidate.match(/\d/g) ?? []).length;
    if (digitCount < 6 || digitCount > 15) return match;
    return `${prefix}[PHONE]`;
  });

  // Bank card numbers (16-19 digits) with a Luhn check.
  out = out.replace(/(^|[^\w])([0-9][0-9 -]{14,}[0-9])(?!\w)/g, (match, prefix: string, candidate: string) => {
    const digits = candidate.replace(/[^\d]/g, '');
    if (digits.length < 16 || digits.length > 19) return match;
    if (!luhnCheck(digits)) return match;
    return `${prefix}[BANK_CARD]`;
  });

  return out;
}

function sanitizeSenderName(message: Message, anonymize: boolean): string {
  if (!anonymize) return message.senderName;
  return message.direction === 'incoming' ? '对方' : '我';
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function stripRaw(message: Message): Message {
  const { raw, ...rest } = message;
  void raw;
  return rest;
}

/**
 * Sanitizes the outbound context for LLM calls:
 * - caps message counts and sizes
 * - optionally redacts common PII patterns
 * - optionally anonymizes sender names
 * - strips `raw` fields
 */
export function sanitizeOutboundContext(
  context: ConversationContext,
  options: OutboundPrivacyOptions = {}
): ConversationContext {
  const maxRecentMessages = clamp(
    normalizePositiveInt(options.maxRecentMessages, DEFAULTS.maxRecentMessages),
    1,
    50
  );
  const maxCharsPerMessage = clamp(
    normalizePositiveInt(options.maxCharsPerMessage, DEFAULTS.maxCharsPerMessage),
    50,
    4000
  );
  const maxTotalChars = clamp(
    normalizePositiveInt(options.maxTotalChars, DEFAULTS.maxTotalChars),
    200,
    20_000
  );
  const redact = options.redactPii ?? DEFAULTS.redactPii;
  const anonymize = options.anonymizeSenderNames ?? DEFAULTS.anonymizeSenderNames;

  const recent = context.recentMessages.slice(-maxRecentMessages).map(stripRaw);
  const current = stripRaw(context.currentMessage);

  const sanitizeMessage = (m: Message): Message => {
    const senderName = sanitizeSenderName(m, anonymize);
    let text = (m.text ?? '').toString();
    if (redact) text = redactPii(text);
    text = truncateText(text, maxCharsPerMessage);
    return { ...m, senderName, text };
  };

  const sanitizedRecent = recent.map(sanitizeMessage);
  const sanitizedCurrent = sanitizeMessage(current);

  // Total-budget trimming (from the oldest recent messages first).
  const budgetMessages = [...sanitizedRecent, sanitizedCurrent];
  let remaining = maxTotalChars;
  const trimmed: Message[] = [];
  for (let i = budgetMessages.length - 1; i >= 0; i -= 1) {
    const m = budgetMessages[i];
    const cost = m.text.length;
    if (remaining <= 0) break;
    if (cost <= remaining) {
      trimmed.push(m);
      remaining -= cost;
    } else {
      trimmed.push({ ...m, text: m.text.slice(Math.max(0, cost - remaining)) });
      remaining = 0;
    }
  }
  trimmed.reverse();

  const finalRecent = trimmed.slice(0, Math.max(0, trimmed.length - 1));
  const finalCurrent = trimmed[trimmed.length - 1] ?? sanitizedCurrent;

  return {
    contactKey: context.contactKey,
    recentMessages: finalRecent,
    currentMessage: finalCurrent,
  };
}
