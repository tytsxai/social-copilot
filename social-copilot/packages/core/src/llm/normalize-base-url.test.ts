import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './normalize-base-url';

describe('normalizeBaseUrl', () => {
  it('trims whitespace and removes trailing slashes', () => {
    expect(normalizeBaseUrl(' https://api.openai.com/ ')).toBe('https://api.openai.com');
  });

  it('strips trailing /v1', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com');
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com');
  });

  it('strips /v1 and deeper paths (common copy/paste)', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com');
    expect(normalizeBaseUrl('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com');
  });

  it('preserves custom base paths and only removes the /v1 segment', () => {
    expect(normalizeBaseUrl('https://proxy.example.com/openai/v1')).toBe('https://proxy.example.com/openai');
    expect(normalizeBaseUrl('https://proxy.example.com/openai/v1/chat/completions')).toBe('https://proxy.example.com/openai');
  });
});

