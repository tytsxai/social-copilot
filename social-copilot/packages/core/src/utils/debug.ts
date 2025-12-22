type EnvLike = { DEBUG?: string };
type ProcessLike = { env?: EnvLike };

export function isDebugEnabled(): boolean {
  const globalRef = globalThis as { process?: ProcessLike };
  return Boolean(globalRef.process?.env?.DEBUG);
}
