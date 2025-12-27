type ChromeLastError = { message?: string };

type WebExtEventLike<TListener> = {
  addListener?: (listener: TListener) => void;
  removeListener?: (listener: TListener) => void;
};

type RuntimeOnMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void
) => boolean | void;

type WebExtRuntimeLike = {
  lastError?: ChromeLastError;
  id?: string;
  sendMessage?: (...args: unknown[]) => unknown;
  openOptionsPage?: () => void;
  getManifest?: () => { version?: string };
  onInstalled?: WebExtEventLike<(...args: unknown[]) => unknown>;
  onStartup?: WebExtEventLike<() => unknown>;
  onMessage?: WebExtEventLike<RuntimeOnMessageListener>;
};

type WebExtStorageAreaLike = {
  get?: (...args: unknown[]) => unknown;
  set?: (...args: unknown[]) => unknown;
  remove?: (...args: unknown[]) => unknown;
  clear?: (...args: unknown[]) => unknown;
};

type StorageChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

type ChromeStorageOnChangedLike = {
  addListener?: (listener: StorageChangeListener) => void;
  removeListener?: (listener: StorageChangeListener) => void;
};

type ChromeStorageLike = {
  local?: WebExtStorageAreaLike;
  session?: WebExtStorageAreaLike;
  onChanged?: ChromeStorageOnChangedLike;
};

type ChromeApiLike = {
  runtime?: WebExtRuntimeLike;
  storage?: ChromeStorageLike;
};

const getChromeApi = (): ChromeApiLike | null => {
  const g = globalThis as typeof globalThis & { chrome?: ChromeApiLike };
  return g.chrome ?? null;
};

const getBrowserApi = (): ChromeApiLike | null => {
  const g = globalThis as typeof globalThis & { browser?: ChromeApiLike };
  return g.browser ?? null;
};

const getPreferredApi = (): ChromeApiLike | null => {
  return getBrowserApi() ?? getChromeApi();
};

const isThenable = (value: unknown): value is Promise<unknown> => {
  return Boolean(value) && typeof (value as { then?: unknown }).then === 'function';
};

const getLastError = (): ChromeLastError | undefined => {
  // Only Chrome-style APIs expose lastError; safe to read even when absent.
  const g = globalThis as typeof globalThis & { chrome?: ChromeApiLike };
  return g.chrome?.runtime?.lastError;
};

function callChromeAsync<T>(invoke: (callback: (result: T) => void) => unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const callback = (result: T) => {
      if (settled) return;
      settled = true;
      const err = getLastError();
      if (err?.message) {
        reject(new Error(err.message));
      } else {
        resolve(result);
      }
    };

    let returned: unknown;
    try {
      returned = invoke(callback);
    } catch (err) {
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (isThenable(returned)) {
      (returned as Promise<T>).then(
        (result) => {
          if (settled) return;
          settled = true;
          resolve(result);
        },
        (err) => {
          if (settled) return;
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    }
  });
}

function callChromeVoidAsync(invoke: (callback: () => void) => unknown): Promise<void> {
  return callChromeAsync<void>((cb) => invoke(cb));
}

export async function runtimeSendMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
  const chromeRuntime = getChromeApi()?.runtime;
  if (chromeRuntime?.sendMessage) {
    return callChromeAsync<TResponse>((callback) => chromeRuntime.sendMessage?.(message, callback));
  }

  const browserRuntime = getBrowserApi()?.runtime;
  if (browserRuntime?.sendMessage) {
    const returned = browserRuntime.sendMessage(message);
    if (isThenable(returned)) return returned as Promise<TResponse>;
    return returned as TResponse;
  }

  throw new Error('Extension runtime is unavailable');
}

export function runtimeOpenOptionsPage(): void {
  try {
    getPreferredApi()?.runtime?.openOptionsPage?.();
  } catch {
    // ignore
  }
}

export function runtimeGetManifestVersion(): string {
  try {
    const version = getPreferredApi()?.runtime?.getManifest?.()?.version;
    return typeof version === 'string' ? version : '';
  } catch {
    return '';
  }
}

export function runtimeGetId(): string | null {
  try {
    const id = getPreferredApi()?.runtime?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function addRuntimeOnInstalledListener(listener: (...args: unknown[]) => unknown): void {
  getPreferredApi()?.runtime?.onInstalled?.addListener?.(listener);
}

export function addRuntimeOnStartupListener(listener: () => unknown): void {
  getPreferredApi()?.runtime?.onStartup?.addListener?.(listener);
}

export function addRuntimeOnMessageListener(listener: RuntimeOnMessageListener): void {
  getPreferredApi()?.runtime?.onMessage?.addListener?.(listener);
}

export function getStorageSessionArea(): WebExtStorageAreaLike | null {
  return getChromeApi()?.storage?.session ?? getBrowserApi()?.storage?.session ?? null;
}

export async function storageSessionGet<T extends Record<string, unknown> = Record<string, unknown>>(
  keys: string | string[] | null
): Promise<T | null> {
  const chromeArea = getChromeApi()?.storage?.session;
  if (chromeArea?.get) {
    return callChromeAsync<T>((callback) => chromeArea.get?.(keys, callback));
  }

  const browserArea = getBrowserApi()?.storage?.session;
  if (browserArea?.get) {
    const returned = browserArea.get(keys);
    if (isThenable(returned)) return (await returned) as T;
    return returned as T;
  }

  return null;
}

export async function storageSessionSet(items: Record<string, unknown>): Promise<boolean> {
  const chromeArea = getChromeApi()?.storage?.session;
  if (chromeArea?.set) {
    await callChromeVoidAsync((callback) => chromeArea.set?.(items, callback));
    return true;
  }

  const browserArea = getBrowserApi()?.storage?.session;
  if (browserArea?.set) {
    const returned = browserArea.set(items);
    if (isThenable(returned)) await returned;
    return true;
  }

  return false;
}

export async function storageSessionRemove(keys: string | string[]): Promise<boolean> {
  const chromeArea = getChromeApi()?.storage?.session;
  if (chromeArea?.remove) {
    await callChromeVoidAsync((callback) => chromeArea.remove?.(keys, callback));
    return true;
  }

  const browserArea = getBrowserApi()?.storage?.session;
  if (browserArea?.remove) {
    const returned = browserArea.remove(keys);
    if (isThenable(returned)) await returned;
    return true;
  }

  return false;
}

export async function storageLocalGet<T extends Record<string, unknown> = Record<string, unknown>>(
  keys: string | string[] | null
): Promise<T> {
  const chromeArea = getChromeApi()?.storage?.local;
  if (chromeArea?.get) {
    return callChromeAsync<T>((callback) => chromeArea.get?.(keys, callback));
  }

  const browserArea = getBrowserApi()?.storage?.local;
  if (browserArea?.get) {
    const returned = browserArea.get(keys);
    if (isThenable(returned)) return (await returned) as T;
    return returned as T;
  }

  return {} as T;
}

export async function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  const chromeArea = getChromeApi()?.storage?.local;
  if (chromeArea?.set) {
    await callChromeVoidAsync((callback) => chromeArea.set?.(items, callback));
    return;
  }

  const browserArea = getBrowserApi()?.storage?.local;
  if (browserArea?.set) {
    const returned = browserArea.set(items);
    if (isThenable(returned)) await returned;
  }
}

export async function storageLocalRemove(keys: string | string[]): Promise<void> {
  const chromeArea = getChromeApi()?.storage?.local;
  if (chromeArea?.remove) {
    await callChromeVoidAsync((callback) => chromeArea.remove?.(keys, callback));
    return;
  }

  const browserArea = getBrowserApi()?.storage?.local;
  if (browserArea?.remove) {
    const returned = browserArea.remove(keys);
    if (isThenable(returned)) await returned;
  }
}

export async function storageLocalClear(): Promise<void> {
  const chromeArea = getChromeApi()?.storage?.local;
  if (chromeArea?.clear) {
    await callChromeVoidAsync((callback) => chromeArea.clear?.(callback));
    return;
  }

  const browserArea = getBrowserApi()?.storage?.local;
  if (browserArea?.clear) {
    const returned = browserArea.clear();
    if (isThenable(returned)) await returned;
  }
}

export function addStorageOnChangedListener(
  listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
): void {
  getPreferredApi()?.storage?.onChanged?.addListener?.(listener);
}

export function removeStorageOnChangedListener(
  listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
): void {
  getPreferredApi()?.storage?.onChanged?.removeListener?.(listener);
}
