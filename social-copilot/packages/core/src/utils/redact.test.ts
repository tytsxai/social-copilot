import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('redacts OpenAI-like sk- keys', () => {
    const input = 'Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz0123456789.';
    const out = redactSecrets(input);
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).toContain('sk-***REDACTED***');
  });

  it('redacts Anthropic sk-ant- keys', () => {
    const input = 'invalid key sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
    const out = redactSecrets(input);
    expect(out).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).toContain('sk-ant-***REDACTED***');
  });

  it('is idempotent', () => {
    const input = 'sk-***REDACTED***';
    expect(redactSecrets(input)).toBe('sk-***REDACTED***');
  });

  it('keeps non-secret strings intact', () => {
    const input = 'status 401 unauthorized';
    expect(redactSecrets(input)).toBe(input);
  });
});

