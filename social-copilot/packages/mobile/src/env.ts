// Simple runtime env shim for Expo (dev-only).
//
// SECURITY WARNING:
// Never store or read LLM API keys in the mobile client. Any value available here can be
// bundled into the app and extracted by attackers. Use a backend proxy and keep secrets
// server-side; the client should only hold a user session token.
import type { ProviderType } from '@social-copilot/core';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const getApiKey = (): string | undefined => {
  if (!isDev) return undefined;
  return process.env.EXPO_PUBLIC_LLM_API_KEY;
};

export const getProvider = (): ProviderType | undefined => {
  if (!isDev) return undefined;
  const raw = process.env.EXPO_PUBLIC_LLM_PROVIDER;
  if (raw === 'deepseek' || raw === 'openai' || raw === 'claude') return raw;
  return undefined;
};

export const getModel = (): string | undefined => {
  if (!isDev) return undefined;
  const raw = process.env.EXPO_PUBLIC_LLM_MODEL;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};
