import { describe, expect, test } from 'vitest';
import type { ReplyStyle } from '../types';
import { extractJsonBlock, parseReplyContent, ReplyParseError, sanitizeReplyContent } from './reply-validation';

describe('reply-validation', () => {
  test('extractJsonBlock finds the first balanced JSON block', () => {
    const blob = '前置说明 {"name":"Ada","tags":[1,{"x":2}]} 更多文字 [1,2,3]';
    const extracted = extractJsonBlock(blob);
    expect(extracted).toBe('{"name":"Ada","tags":[1,{"x":2}]}');
  });

  test('extractJsonBlock prefers the earliest bracket regardless of type', () => {
    const blob = '前缀 [1, {"x":2}] 还有 {"later":true}';
    const extracted = extractJsonBlock(blob);
    expect(extracted).toBe('[1, {"x":2}]');
  });

  test('extractJsonBlock ignores braces inside strings', () => {
    const blob = 'prefix {"text":"hello } world","ok":true} suffix {"later":1}';
    const extracted = extractJsonBlock(blob);
    expect(extracted).toBe('{"text":"hello } world","ok":true}');
  });

  test('parses reply array content and fills missing styles', () => {
    const content = JSON.stringify([
      { text: 'hi there' },
      { style: 'humorous', text: 'yo' },
    ]);
    const styles: ReplyStyle[] = ['caring', 'rational'];

    const result = parseReplyContent(content, styles);

    expect(result).toEqual([
      { style: 'caring', text: 'hi there', confidence: 0.8 },
      { style: 'humorous', text: 'yo', confidence: 0.8 },
    ]);
  });

  test('throws ReplyParseError on invalid candidates', () => {
    const malformed = JSON.stringify([{ style: '', text: '' }]);
    expect(() => parseReplyContent(malformed, ['casual'])).toThrow(ReplyParseError);
  });

  test('normalizes style aliases to allowed ReplyStyle values', () => {
    const content = JSON.stringify([
      { style: '幽默', text: '哈哈' },
      { style: 'FORMAL', text: '您好。' },
    ]);

    const result = parseReplyContent(content, ['caring', 'casual']);

    expect(result[0].style).toBe('humorous');
    expect(result[1].style).toBe('formal');
  });

  test('throws ReplyParseError when candidate text is not a string', () => {
    const content = JSON.stringify([{ style: 'caring', text: 123 }]);
    expect(() => parseReplyContent(content, ['caring'])).toThrow(ReplyParseError);
  });

  test('tolerates bare string arrays by treating them as text candidates', () => {
    const content = JSON.stringify(['hello']);
    const result = parseReplyContent(content, ['caring']);
    expect(result).toEqual([{ style: 'caring', text: 'hello', confidence: 0.8 }]);
  });

  test('sanitizeReplyContent encodes HTML entities', () => {
    const content = JSON.stringify([
      { style: 'caring', text: '<img src=x onerror="alert(1)"> & "\'<' },
    ]);
    const parsed = JSON.parse(content);
    expect(sanitizeReplyContent(parsed[0].text)).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;&#39;&lt;');
  });

  test('rejects overly large candidate text', () => {
    const huge = 'a'.repeat(25_000);
    const content = JSON.stringify([{ style: 'caring', text: huge }]);
    expect(() => parseReplyContent(content, ['caring'])).toThrow(ReplyParseError);
  });

  test('keeps raw JSON when running profile_extraction task', () => {
    const profileSnippet = '请整理画像： {"name":"Bob","city":"SF"}';
    const parsed = parseReplyContent(profileSnippet, [], 'profile_extraction');

    expect(parsed).toHaveLength(1);
    expect(parsed[0].style).toBe('rational');
    expect(parsed[0].text).toBe('{"name":"Bob","city":"SF"}');
  });
});
