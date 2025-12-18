/**
 * Best-effort redaction for secret-like tokens (API keys) from logs/errors/diagnostics.
 *
 * Notes:
 * - This is intentionally conservative and only targets common key prefixes.
 * - It is not meant to be a full DLP system; it prevents accidental leakage in error messages.
 */

const REDACTIONS: Array<{ re: RegExp; replacement: string }> = [
  // Anthropic keys: sk-ant-...
  { re: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, replacement: 'sk-ant-***REDACTED***' },
  // OpenAI / DeepSeek and other "sk-..." keys.
  { re: /\bsk-[A-Za-z0-9_-]{10,}\b/g, replacement: 'sk-***REDACTED***' },
];

export function redactSecrets(text: string): string {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const { re, replacement } of REDACTIONS) {
    out = out.replace(re, replacement);
  }
  return out;
}

