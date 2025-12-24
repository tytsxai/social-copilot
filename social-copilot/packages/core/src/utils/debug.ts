type EnvLike = { DEBUG?: string };
type ProcessLike = { env?: EnvLike };

export function isDebugEnabled(): boolean {
  // Always disable debug logs in production unless explicitly enabled
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    if (typeof process.env.DEBUG === 'undefined') {
      return false;
    }
  }

  const globalRef = globalThis as { process?: ProcessLike };
  return Boolean(globalRef.process?.env?.DEBUG);
}
