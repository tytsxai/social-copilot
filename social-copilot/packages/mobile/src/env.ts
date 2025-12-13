// Simple runtime env shim for Expo (uses EXPO_PUBLIC_* envs injected by Metro)
import type { ProviderType } from '@social-copilot/core';

export const getApiKey = (): string | undefined => process.env.EXPO_PUBLIC_LLM_API_KEY;

export const getProvider = (): ProviderType | undefined => {
  const raw = process.env.EXPO_PUBLIC_LLM_PROVIDER;
  if (raw === 'deepseek' || raw === 'openai' || raw === 'claude') return raw;
  return undefined;
};

export const getModel = (): string | undefined => {
  const raw = process.env.EXPO_PUBLIC_LLM_MODEL;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};
