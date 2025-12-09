// Simple runtime env shim for Expo (uses EXPO_PUBLIC_* envs injected by Metro)
export const getApiKey = (): string | undefined => process.env.EXPO_PUBLIC_LLM_API_KEY;
