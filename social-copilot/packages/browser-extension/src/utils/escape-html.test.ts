import { describe, expect, test } from 'vitest';
import { escapeHtml, safeUrl } from './escape-html';

describe('escapeHtml', () => {
  test('stringifies non-string inputs', () => {
    expect(escapeHtml(null as unknown as string)).toBe('null');
    expect(escapeHtml(undefined as unknown as string)).toBe('undefined');
    expect(escapeHtml({} as unknown as string)).toBe('[object Object]');
  });

  test('escapes control characters and JS line separators', () => {
    const input = `a\x00b\x1Fc\x7Fd\u2028e\u2029f`;
    expect(escapeHtml(input)).toBe(
      'a&#x0;b&#x1f;c&#x7f;d&#x2028;e&#x2029;f',
    );
  });

  test('escapes nested HTML injection attempts', () => {
    const input = '<div><img src=x onerror=alert(1)></div>';
    expect(escapeHtml(input)).toBe(
      '&lt;div&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/div&gt;',
    );
  });
});

describe('safeUrl', () => {
  test('allows http, https, and mailto', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
  });

  test('rejects javascript/data/vbscript protocols', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
  });
});
