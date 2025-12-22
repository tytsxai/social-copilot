const DEBUG_ENABLED_STORAGE_KEY = 'debugEnabled';

let debugEnabled = false;
let debugInitialized = false;

function ensureDebugInitialized(): void {
  if (debugInitialized) return;
  debugInitialized = true;

  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage) return;

  storage
    .get(DEBUG_ENABLED_STORAGE_KEY)
    .then((result) => {
      debugEnabled = Boolean(result[DEBUG_ENABLED_STORAGE_KEY]);
    })
    .catch(() => {
      // ignore
    });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[DEBUG_ENABLED_STORAGE_KEY];
    if (change) {
      debugEnabled = Boolean(change.newValue);
    }
  });
}

export function isDebugEnabled(): boolean {
  ensureDebugInitialized();
  return debugEnabled;
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
}

export function debugError(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.error(...args);
  }
}
