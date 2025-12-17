/**
 * Extract the first JSON block (array or object) from a text blob.
 * Uses bracket-balanced scan to avoid greedy regex mistakes.
 */
export function extractJsonBlock(text: string): string | null {
  if (typeof text !== 'string') return null;

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

function extractBlockByDelimiters(text: string, startChar: '{' | '[', endChar: '}' | ']'): string | null {
  const start = text.indexOf(startChar);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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

