import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
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

  it('rejects non-https baseUrl by default', () => {
    expect(() => normalizeBaseUrl('http://api.example.com')).toThrow(/https/i);
  });

  it('allows http when allowInsecureHttp is true', () => {
    expect(normalizeBaseUrl('http://api.example.com/', { allowInsecureHttp: true })).toBe('http://api.example.com');
  });

  it('rejects localhost and private IPs by default', () => {
    expect(() => normalizeBaseUrl('https://localhost:1234')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://127.0.0.1')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://10.0.0.1')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://192.168.1.2')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://172.16.0.1')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://169.254.0.10')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://[::1]')).toThrow(/localhost|private/i);
    expect(() => normalizeBaseUrl('https://[fd00::1]')).toThrow(/localhost|private/i);
  });

  it('allows localhost/private hosts when allowPrivateHosts is true', () => {
    expect(normalizeBaseUrl('https://localhost:1234', { allowPrivateHosts: true })).toBe('https://localhost:1234');
    expect(normalizeBaseUrl('https://127.0.0.1', { allowPrivateHosts: true })).toBe('https://127.0.0.1');
  });
});

describe('Provider apiKey validation', () => {
  it('throws on invalid OpenAI apiKey', () => {
    expect(() => new OpenAIProvider({ apiKey: '   ' })).toThrow(/apiKey/i);
  });

  it('throws on invalid Claude apiKey', () => {
    expect(() => new ClaudeProvider({ apiKey: 'sk-xxx' })).toThrow(/apiKey/i);
  });
});
