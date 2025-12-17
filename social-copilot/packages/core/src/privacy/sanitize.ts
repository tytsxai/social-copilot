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

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function redactPii(text: string): string {
  let out = text;

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

  // Phone numbers (international + local), plus Chinese mobile numbers.
  out = out.replace(/\b1[3-9]\d{9}\b/g, '[PHONE]');
  out = out.replace(
    /(?<!\w)(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{6,12}(?!\w)/g,
    '[PHONE]'
  );

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

