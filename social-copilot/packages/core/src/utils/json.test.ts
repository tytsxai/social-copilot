import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  extractJsonBlock,
  extractJsonObjectBlock,
  extractJsonArrayBlock,
  parseJsonObjectFromText,
} from './json';

describe('extractJsonBlock', () => {
  it('extracts simple object', () => {
    const text = 'Some text {"key": "value"} more text';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts simple array', () => {
    const text = 'prefix [1, 2, 3] suffix';
    const result = extractJsonBlock(text);
    expect(result).toBe('[1, 2, 3]');
  });

  it('extracts nested object', () => {
    const text = '{"outer": {"inner": {"deep": "value"}}}';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"outer": {"inner": {"deep": "value"}}}');
  });

  it('extracts nested array', () => {
    const text = '[[1, [2, 3]], [4, 5]]';
    const result = extractJsonBlock(text);
    expect(result).toBe('[[1, [2, 3]], [4, 5]]');
  });

  it('extracts object with array', () => {
    const text = '{"items": [1, 2, 3], "count": 3}';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"items": [1, 2, 3], "count": 3}');
  });

  it('extracts array with object', () => {
    const text = '[{"id": 1}, {"id": 2}]';
    const result = extractJsonBlock(text);
    expect(result).toBe('[{"id": 1}, {"id": 2}]');
  });

  it('returns first JSON block when multiple exist', () => {
    const text = '{"first": 1} some text {"second": 2}';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"first": 1}');
  });

  it('prefers earlier starting position', () => {
    const text = 'text {"obj": 1} [1, 2]';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"obj": 1}');
  });

  it('prefers array when it starts first', () => {
    const text = 'text [1, 2] {"obj": 1}';
    const result = extractJsonBlock(text);
    expect(result).toBe('[1, 2]');
  });

  it('returns null for incomplete object', () => {
    const text = '{"key": "value"';
    const result = extractJsonBlock(text);
    expect(result).toBeNull();
  });

  it('returns null for incomplete array', () => {
    const text = '[1, 2, 3';
    const result = extractJsonBlock(text);
    expect(result).toBeNull();
  });

  it('returns null when no JSON found', () => {
    const text = 'just plain text without json';
    const result = extractJsonBlock(text);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = extractJsonBlock('');
    expect(result).toBeNull();
  });

  it('returns null for non-string input', () => {
    const result = extractJsonBlock(123 as any);
    expect(result).toBeNull();
  });

  it('handles JSON with text before and after', () => {
    const text = 'prefix text {"key": "value"} suffix text';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"key": "value"}');
  });

  it('handles deeply nested structures', () => {
    const text = '{"a": {"b": {"c": {"d": {"e": "deep"}}}}}';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"a": {"b": {"c": {"d": {"e": "deep"}}}}}');
  });

  it('handles empty object', () => {
    const text = 'text {} text';
    const result = extractJsonBlock(text);
    expect(result).toBe('{}');
  });

  it('handles empty array', () => {
    const text = 'text [] text';
    const result = extractJsonBlock(text);
    expect(result).toBe('[]');
  });

  it('ignores closing braces inside double-quoted strings', () => {
    const text = 'prefix {"text":"hello } world","ok":true} suffix';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"text":"hello } world","ok":true}');
  });

  it('ignores closing brackets inside double-quoted strings in arrays', () => {
    const text = 'prefix ["a ] b", 1, 2] suffix';
    const result = extractJsonBlock(text);
    expect(result).toBe('["a ] b", 1, 2]');
  });

  it('handles escaped quotes inside strings when scanning', () => {
    const text = 'prefix {"text":"she said: \\"}\\", ok","n":1} suffix';
    const result = extractJsonBlock(text);
    expect(result).toBe('{"text":"she said: \\"}\\", ok","n":1}');
  });
});

describe('extractJsonObjectBlock', () => {
  it('extracts simple object', () => {
    const text = 'prefix {"key": "value"} suffix';
    const result = extractJsonObjectBlock(text);
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts nested object', () => {
    const text = '{"outer": {"inner": "value"}}';
    const result = extractJsonObjectBlock(text);
    expect(result).toBe('{"outer": {"inner": "value"}}');
  });

  it('extracts object with array', () => {
    const text = '{"items": [1, 2, 3]}';
    const result = extractJsonObjectBlock(text);
    expect(result).toBe('{"items": [1, 2, 3]}');
  });

  it('returns null for incomplete object', () => {
    const text = '{"key": "value"';
    const result = extractJsonObjectBlock(text);
    expect(result).toBeNull();
  });

  it('returns null when no object found', () => {
    const text = 'no object here';
    const result = extractJsonObjectBlock(text);
    expect(result).toBeNull();
  });

  it('ignores arrays', () => {
    const text = '[1, 2, 3]';
    const result = extractJsonObjectBlock(text);
    expect(result).toBeNull();
  });

  it('handles object with text before and after', () => {
    const text = 'some text {"key": "value"} more text';
    const result = extractJsonObjectBlock(text);
    expect(result).toBe('{"key": "value"}');
  });

  it('handles empty object', () => {
    const text = 'text {} text';
    const result = extractJsonObjectBlock(text);
    expect(result).toBe('{}');
  });
});

describe('extractJsonArrayBlock', () => {
  it('extracts simple array', () => {
    const text = 'prefix [1, 2, 3] suffix';
    const result = extractJsonArrayBlock(text);
    expect(result).toBe('[1, 2, 3]');
  });

  it('extracts nested array', () => {
    const text = '[[1, 2], [3, 4]]';
    const result = extractJsonArrayBlock(text);
    expect(result).toBe('[[1, 2], [3, 4]]');
  });

  it('extracts array with objects', () => {
    const text = '[{"id": 1}, {"id": 2}]';
    const result = extractJsonArrayBlock(text);
    expect(result).toBe('[{"id": 1}, {"id": 2}]');
  });

  it('returns null for incomplete array', () => {
    const text = '[1, 2, 3';
    const result = extractJsonArrayBlock(text);
    expect(result).toBeNull();
  });

  it('returns null when no array found', () => {
    const text = 'no array here';
    const result = extractJsonArrayBlock(text);
    expect(result).toBeNull();
  });

  it('ignores objects', () => {
    const text = '{"key": "value"}';
    const result = extractJsonArrayBlock(text);
    expect(result).toBeNull();
  });

  it('handles array with text before and after', () => {
    const text = 'some text [1, 2, 3] more text';
    const result = extractJsonArrayBlock(text);
    expect(result).toBe('[1, 2, 3]');
  });

  it('handles empty array', () => {
    const text = 'text [] text';
    const result = extractJsonArrayBlock(text);
    expect(result).toBe('[]');
  });
});

describe('parseJsonObjectFromText', () => {
  it('parses normal object', () => {
    const text = '{"key": "value", "num": 42}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('parses nested object', () => {
    const text = '{"outer": {"inner": "value"}}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ outer: { inner: 'value' } });
  });

  it('parses object with array', () => {
    const text = '{"items": [1, 2, 3]}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('parses empty object', () => {
    const text = '{}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({});
  });

  it('parses object with special characters', () => {
    const text = '{"key": "value with \\"quotes\\" and \\n newline"}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ key: 'value with "quotes" and \n newline' });
  });

  it('parses object with text before and after', () => {
    const text = 'prefix {"key": "value"} suffix';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('throws error for malformed JSON', () => {
    const text = '{"key": invalid}';
    expect(() => parseJsonObjectFromText(text)).toThrow();
  });

  it('throws error when top-level is array', () => {
    const text = '[1, 2, 3]';
    expect(() => parseJsonObjectFromText(text)).toThrow('Top-level JSON is not an object');
  });

  it('throws error when no JSON found', () => {
    const text = 'no json here';
    expect(() => parseJsonObjectFromText(text)).toThrow('No JSON object found in text');
  });

  it('throws error for incomplete object', () => {
    const text = '{"key": "value"';
    expect(() => parseJsonObjectFromText(text)).toThrow('No JSON object found in text');
  });

  it('parses object with unicode characters', () => {
    const text = '{"emoji": "😀", "chinese": "你好"}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ emoji: '😀', chinese: '你好' });
  });

  it('parses object with null and boolean values', () => {
    const text = '{"null": null, "bool": true, "false": false}';
    const result = parseJsonObjectFromText(text);
    expect(result).toEqual({ null: null, bool: true, false: false });
  });
});

describe('Property-based tests', () => {
  // Helper to check if a string contains bracket characters that would confuse the parser
  const hasBracketChars = (str: string): boolean => {
    return /[\[\]{}]/.test(str);
  };

  // Helper to check if a value contains bracket chars in any string key or value
  const containsBracketChars = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return hasBracketChars(value);
    }
    if (Array.isArray(value)) {
      return value.some(containsBracketChars);
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).some(
        ([k, v]) => hasBracketChars(k) || containsBracketChars(v)
      );
    }
    return false;
  };

  it('extracts valid JSON objects that can be parsed', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Skip values with bracket characters in keys/values
          if (containsBracketChars(value)) return;

          const jsonStr = JSON.stringify(value);
          const text = `prefix ${jsonStr} suffix`;
          const extracted = extractJsonBlock(text);
          expect(extracted).not.toBeNull();
          if (extracted) {
            const parsed = JSON.parse(extracted);
            expect(parsed).toEqual(value);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('extracts valid JSON arrays that can be parsed', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue()), (value) => {
        // Skip values with bracket characters
        if (containsBracketChars(value)) return;

        const jsonStr = JSON.stringify(value);
        const text = `prefix ${jsonStr} suffix`;
        const extracted = extractJsonBlock(text);
        expect(extracted).not.toBeNull();
        if (extracted) {
          const parsed = JSON.parse(extracted);
          expect(parsed).toEqual(value);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('handles deeply nested structures', () => {
    // Use safe string generator without bracket characters
    const safeString = fc.string().filter((s) => !hasBracketChars(s));

    const deepObjectArb = fc.letrec((tie) => ({
      value: fc.oneof(
        safeString,
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('value'), { maxLength: 3 }),
        fc.dictionary(safeString, tie('value'), { maxKeys: 3 })
      ),
    })).value;

    fc.assert(
      fc.property(deepObjectArb, (value) => {
        const jsonStr = JSON.stringify(value);
        const text = `text ${jsonStr} text`;
        const extracted = extractJsonBlock(text);
        if (extracted) {
          const parsed = JSON.parse(extracted);
          expect(parsed).toEqual(value);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('parseJsonObjectFromText accepts valid objects', () => {
    // Only test with safe objects (no bracket chars in keys/values)
    const safeString = fc.string().filter((s) => !hasBracketChars(s));
    const safeObject = fc.dictionary(safeString, fc.oneof(
      safeString,
      fc.integer(),
      fc.boolean(),
      fc.constant(null)
    ));

    fc.assert(
      fc.property(safeObject, (value) => {
        const jsonStr = JSON.stringify(value);
        const text = `prefix ${jsonStr} suffix`;
        const result = parseJsonObjectFromText(text);
        expect(result).toEqual(value);
      }),
      { numRuns: 100 }
    );
  });

  it('handles safe random text with embedded JSON', () => {
    // Use safe prefix/suffix and safe JSON values
    const safeText = fc.string().filter((s) => !hasBracketChars(s));
    const safeString = fc.string().filter((s) => !hasBracketChars(s));
    const safeValue = fc.oneof(
      safeString,
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.oneof(safeString, fc.integer(), fc.boolean()), { maxLength: 5 }),
      fc.dictionary(safeString, fc.oneof(safeString, fc.integer()), { maxKeys: 3 })
    );

    fc.assert(
      fc.property(
        safeText,
        safeValue,
        safeText,
        (prefix, value, suffix) => {
          const jsonStr = JSON.stringify(value);
          const text = `${prefix}${jsonStr}${suffix}`;
          const extracted = extractJsonBlock(text);

          if (extracted) {
            const parsed = JSON.parse(extracted);
            expect(parsed).toEqual(value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
