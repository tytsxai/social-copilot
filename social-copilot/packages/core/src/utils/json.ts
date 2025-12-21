/**
 * Extract the first JSON block (array or object) from a text blob.
 * Uses bracket-balanced scan to avoid greedy regex mistakes.
 */
const DEFAULT_MAX_JSON_SCAN_CHARS = 200_000;

export function extractJsonBlock(text: string, maxScanChars: number = DEFAULT_MAX_JSON_SCAN_CHARS): string | null {
  if (typeof text !== 'string') return null;
  if (text.length === 0) return null;
  if (!Number.isFinite(maxScanChars) || maxScanChars <= 0) return null;

  const candidates = [
    { start: text.indexOf('['), startChar: '[', endChar: ']' },
    { start: text.indexOf('{'), startChar: '{', endChar: '}' },
  ]
    .filter((item) => item.start !== -1)
    .sort((a, b) => a.start - b.start);

  for (const { start, startChar, endChar } of candidates) {
    let depth = 0;
    let inString = false;
    let quoteChar: '"' | "'" | null = null;
    let escapeNext = false;
    const end = Math.min(text.length, start + maxScanChars);

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (i >= end) break;

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (inString) {
        if (ch === '\\') {
          escapeNext = true;
        } else if (ch === quoteChar) {
          inString = false;
          quoteChar = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        continue;
      }

      if (ch === startChar) depth++;
      else if (ch === endChar) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractBlockByDelimiters(
  text: string,
  startChar: '{' | '[',
  endChar: '}' | ']',
  maxScanChars: number = DEFAULT_MAX_JSON_SCAN_CHARS,
): string | null {
  const start = text.indexOf(startChar);
  if (start === -1) return null;
  if (!Number.isFinite(maxScanChars) || maxScanChars <= 0) return null;

  let depth = 0;
  let inString = false;
  let quoteChar: '"' | "'" | null = null;
  let escapeNext = false;
  const end = Math.min(text.length, start + maxScanChars);

  for (let i = start; i < end; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true;
      } else if (ch === quoteChar) {
        inString = false;
        quoteChar = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === startChar) depth++;
    else if (ch === endChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonObjectBlock(text: string): string | null {
  return extractBlockByDelimiters(text, '{', '}');
}

export function extractJsonArrayBlock(text: string): string | null {
  return extractBlockByDelimiters(text, '[', ']');
}

export function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const json = extractJsonObjectBlock(text) ?? extractJsonBlock(text);
  if (!json) {
    throw new Error('No JSON object found in text');
  }
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Top-level JSON is not an object');
  }
  return parsed as Record<string, unknown>;
}
