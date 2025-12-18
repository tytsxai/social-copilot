import type { Message, ContactProfile, ContactKey, StylePreference, ReplyStyle } from '../types';
import type { MemoryStore } from './store';
import { contactKeyToString, contactKeyToStringV1, legacyContactKeyToString, normalizeContactKeyStr } from '../types/contact';

const DB_NAME = 'social-copilot';
const DB_VERSION = 6;
const MAX_MESSAGES_PER_CONTACT = 2000;

const STORES = {
  messages: 'messages',
  profiles: 'profiles',
  // Reserved for legacy/future usage. Runtime config lives in chrome.storage.local.
  settings: 'settings',
  stylePreferences: 'stylePreferences',
  contactMemories: 'contactMemories',
} as const;

export interface ContactMemorySummary {
  contactKeyStr: string;
  summary: string;
  updatedAt: number;
}

export interface IndexedDBSnapshotV1 {
  schemaVersion: 1;
  exportedAt: number;
  profiles: ContactProfile[];
  stylePreferences: StylePreference[];
  contactMemories: ContactMemorySummary[];
}

function getContactKeyStrCandidates(contactKey: ContactKey): string[] {
  const variants: ContactKey[] = [contactKey];

  // Backward-compat: older versions may not include accountId in keys.
  if (contactKey.accountId) {
    variants.push({ ...contactKey, accountId: undefined });
  }

  // Backward-compat: some adapters historically used peerId/displayName as conversationId (not stable).
  // Scope this heuristic to WhatsApp to avoid accidental cross-channel matches on other platforms.
  if (contactKey.app === 'whatsapp' && contactKey.peerId && contactKey.conversationId !== contactKey.peerId) {
    variants.push({ ...contactKey, conversationId: contactKey.peerId });
    if (contactKey.accountId) {
      variants.push({ ...contactKey, accountId: undefined, conversationId: contactKey.peerId });
    }
  }

  const keys = variants.flatMap((key) => [
    contactKeyToString(key),
    contactKeyToStringV1(key),
    legacyContactKeyToString(key),
  ]);

  return Array.from(new Set(keys));
}

function mergeNotes(a?: string, b?: string, maxLength = 2048): string | undefined {
  const parts = [a, b].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .flatMap((v) => v.split('\n').map((line) => line.trim()).filter(Boolean));
  if (parts.length === 0) return undefined;
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p);
  }
  let merged = unique.join('\n');
  if (merged.length > maxLength) {
    merged = merged.slice(-maxLength);
  }
  return merged;
}

function isMeaningfulName(name: string | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return trimmed !== 'Unknown' && trimmed !== '未知';
}

function mergeProfiles(
  existing: ContactProfile & { keyStr: string },
  incoming: ContactProfile & { keyStr: string },
  desiredKey: string
): ContactProfile & { keyStr: string } {
  const base = existing.updatedAt >= incoming.updatedAt ? existing : incoming;
  const other = base === existing ? incoming : existing;

  const displayName = isMeaningfulName(base.displayName)
    ? base.displayName
    : isMeaningfulName(other.displayName)
      ? other.displayName
      : base.displayName || other.displayName || 'Unknown';

  const interests = Array.from(new Set([...(existing.interests ?? []), ...(incoming.interests ?? [])]));
  const communicationStyle = {
    ...(other.communicationStyle ?? {}),
    ...(base.communicationStyle ?? {}),
  };
  const basicInfo = {
    ...(other.basicInfo ?? {}),
    ...(base.basicInfo ?? {}),
  };

  const relationshipType = base.relationshipType ?? other.relationshipType;
  const notes = mergeNotes(existing.notes, incoming.notes);

  return {
    ...base,
    keyStr: desiredKey,
    key: {
      ...base.key,
      peerId: displayName || base.key.peerId,
    },
    displayName,
    interests,
    communicationStyle: Object.keys(communicationStyle).length > 0 ? communicationStyle : undefined,
    basicInfo: Object.keys(basicInfo).length > 0 ? basicInfo : undefined,
    relationshipType,
    notes,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

function mergeStylePreferences(existing: StylePreference, incoming: StylePreference, desiredKey: string): StylePreference {
  const map = new Map<ReplyStyle, { style: ReplyStyle; count: number; lastUsed: number }>();

  const add = (entries: StylePreference['styleHistory']) => {
    for (const entry of entries) {
      const current = map.get(entry.style);
      if (!current) {
        map.set(entry.style, { ...entry });
      } else {
        map.set(entry.style, {
          style: entry.style,
          count: current.count + entry.count,
          lastUsed: Math.max(current.lastUsed, entry.lastUsed),
        });
      }
    }
  };

  add(existing.styleHistory ?? []);
  add(incoming.styleHistory ?? []);

  const styleHistory = Array.from(map.values());

  // Derive default style using the same rule as StylePreferenceManager (>=3)
  const DEFAULT_STYLE_THRESHOLD = 3;
  const top = styleHistory
    .filter((e) => e.count >= DEFAULT_STYLE_THRESHOLD)
    .reduce<typeof styleHistory[number] | null>((best, entry) => {
      if (!best) return entry;
      if (entry.count > best.count) return entry;
      if (entry.count === best.count && entry.lastUsed > best.lastUsed) return entry;
      return best;
    }, null);

  return {
    contactKeyStr: desiredKey,
    styleHistory,
    defaultStyle: top ? top.style : existing.defaultStyle ?? incoming.defaultStyle ?? null,
    updatedAt: Math.max(existing.updatedAt ?? 0, incoming.updatedAt ?? 0),
  };
}

function mergeContactMemories(
  existing: ContactMemorySummary,
  incoming: ContactMemorySummary,
  desiredKey: string
): ContactMemorySummary {
  const pick = existing.updatedAt >= incoming.updatedAt ? existing : incoming;
  return {
    contactKeyStr: desiredKey,
    summary: pick.summary,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isReplyStyle(value: unknown): value is ReplyStyle {
  return value === 'humorous' || value === 'caring' || value === 'rational' || value === 'casual' || value === 'formal';
}

function sanitizeContactKey(raw: unknown): ContactKey | null {
  if (!isPlainObject(raw)) return null;

  const platformRaw = asTrimmedString(raw.platform);
  const appRaw = asTrimmedString(raw.app);

  const platform: ContactKey['platform'] = (
    platformRaw === 'web' ||
    platformRaw === 'windows' ||
    platformRaw === 'mac' ||
    platformRaw === 'android' ||
    platformRaw === 'ios'
  )
    ? (platformRaw as ContactKey['platform'])
    : 'web';

  const app: ContactKey['app'] = (
    appRaw === 'telegram' ||
    appRaw === 'whatsapp' ||
    appRaw === 'slack' ||
    appRaw === 'discord' ||
    appRaw === 'wechat' ||
    appRaw === 'qq' ||
    appRaw === 'other'
  )
    ? (appRaw as ContactKey['app'])
    : 'other';

  const conversationId = asTrimmedString(raw.conversationId);
  if (!conversationId) return null;

  const accountId = asTrimmedString(raw.accountId);
  const peerId = typeof raw.peerId === 'string' ? raw.peerId : String(raw.peerId ?? '');
  const isGroup = Boolean(raw.isGroup);

  return {
    platform,
    app,
    accountId: accountId ? accountId : undefined,
    conversationId,
    peerId,
    isGroup,
  };
}

function sanitizeContactProfile(raw: unknown): ContactProfile | null {
  if (!isPlainObject(raw)) return null;

  const key = sanitizeContactKey(raw.key);
  if (!key) return null;

  const now = Date.now();
  const displayName = asTrimmedString(raw.displayName) || key.peerId || 'Unknown';

  const interests = Array.isArray(raw.interests)
    ? raw.interests.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 50)
    : [];

  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;

  const relationshipTypeRaw = typeof raw.relationshipType === 'string' ? raw.relationshipType : undefined;
  const relationshipType = (
    relationshipTypeRaw === 'friend' ||
    relationshipTypeRaw === 'colleague' ||
    relationshipTypeRaw === 'family' ||
    relationshipTypeRaw === 'acquaintance' ||
    relationshipTypeRaw === 'romantic' ||
    relationshipTypeRaw === 'other'
  )
    ? (relationshipTypeRaw as ContactProfile['relationshipType'])
    : undefined;

  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 4096) : undefined;

  const basicInfoRaw = isPlainObject(raw.basicInfo) ? raw.basicInfo : null;
  const basicInfo = basicInfoRaw
    ? {
        ageRange: typeof basicInfoRaw.ageRange === 'string' ? basicInfoRaw.ageRange.slice(0, 100) : undefined,
        occupation: typeof basicInfoRaw.occupation === 'string' ? basicInfoRaw.occupation.slice(0, 100) : undefined,
        location: typeof basicInfoRaw.location === 'string' ? basicInfoRaw.location.slice(0, 100) : undefined,
      }
    : undefined;
  const normalizedBasicInfo =
    basicInfo && (basicInfo.ageRange || basicInfo.occupation || basicInfo.location) ? basicInfo : undefined;

  const commRaw = isPlainObject(raw.communicationStyle) ? raw.communicationStyle : null;
  const communicationStyle = commRaw
    ? {
        prefersShortMessages: typeof commRaw.prefersShortMessages === 'boolean' ? commRaw.prefersShortMessages : undefined,
        usesEmoji: typeof commRaw.usesEmoji === 'boolean' ? commRaw.usesEmoji : undefined,
        formalityLevel:
          commRaw.formalityLevel === 'casual' || commRaw.formalityLevel === 'neutral' || commRaw.formalityLevel === 'formal'
            ? (commRaw.formalityLevel as 'casual' | 'neutral' | 'formal')
            : undefined,
      }
    : undefined;
  const normalizedCommunicationStyle =
    communicationStyle &&
    (communicationStyle.prefersShortMessages !== undefined ||
      communicationStyle.usesEmoji !== undefined ||
      communicationStyle.formalityLevel !== undefined)
      ? communicationStyle
      : undefined;

  return {
    key,
    displayName,
    basicInfo: normalizedBasicInfo,
    interests,
    communicationStyle: normalizedCommunicationStyle,
    relationshipType,
    notes,
    createdAt,
    updatedAt,
  };
}

function sanitizeStylePreference(raw: unknown): StylePreference | null {
  if (!isPlainObject(raw)) return null;
  const contactKeyStrRaw = asTrimmedString(raw.contactKeyStr);
  if (!contactKeyStrRaw) return null;

  const now = Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;

  const styleHistoryRaw = Array.isArray(raw.styleHistory) ? raw.styleHistory : [];
  const styleHistory = styleHistoryRaw
    .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
    .map((entry) => {
      if (!isReplyStyle(entry.style)) return null;
      const count = typeof entry.count === 'number' && Number.isFinite(entry.count)
        ? Math.max(1, Math.floor(entry.count))
        : null;
      if (count === null) return null;
      const lastUsed = typeof entry.lastUsed === 'number' && Number.isFinite(entry.lastUsed)
        ? Math.max(0, Math.floor(entry.lastUsed))
        : 0;
      return { style: entry.style, count, lastUsed };
    })
    .filter((v): v is { style: ReplyStyle; count: number; lastUsed: number } => v !== null)
    .slice(0, 100);

  const defaultStyle = raw.defaultStyle === null ? null : isReplyStyle(raw.defaultStyle) ? raw.defaultStyle : null;

  return {
    contactKeyStr: normalizeContactKeyStr(contactKeyStrRaw),
    styleHistory,
    defaultStyle,
    updatedAt,
  };
}

function sanitizeContactMemorySummary(raw: unknown): ContactMemorySummary | null {
  if (!isPlainObject(raw)) return null;
  const contactKeyStrRaw = asTrimmedString(raw.contactKeyStr);
  if (!contactKeyStrRaw) return null;

  const summary = asTrimmedString(raw.summary);
  if (!summary) return null;

  const now = Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;

  return {
    contactKeyStr: normalizeContactKeyStr(contactKeyStrRaw),
    summary: summary.slice(0, 4096),
    updatedAt,
  };
}

/**
 * IndexedDB 存储实现
 */
export class IndexedDBStore implements MemoryStore {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    // Defensive: close any previous connection before (re-)opening.
    this.db?.close();
    this.db = null;

    const requiredStores = [STORES.messages, STORES.profiles, STORES.stylePreferences, STORES.contactMemories];

    const ensureSchemaCompatible = (db: IDBDatabase) => {
      const missingStores = requiredStores.filter((name) => !db.objectStoreNames.contains(name));
      if (missingStores.length > 0) {
        throw new Error(`Unsupported IndexedDB schema (missing stores: ${missingStores.join(', ')})`);
      }

      // Runtime safety: ensure at least the indexes that current code relies on exist.
      // (We cannot create indexes without an upgrade transaction.)
      const tx = db.transaction([STORES.messages], 'readonly');
      const msgStore = tx.objectStore(STORES.messages);
      if (!msgStore.indexNames.contains('contactKey')) {
        throw new Error('Unsupported IndexedDB schema (missing messages.contactKey index)');
      }
    };

    const openDb = (options: { version?: number; allowUpgrade: boolean }): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        let finished = false;
        const finishReject = (error: unknown) => {
          if (finished) return;
          finished = true;
          reject(error);
        };
        const finishResolve = (db: IDBDatabase) => {
          if (finished) {
            try {
              db.close();
            } catch {
              // ignore
            }
            return;
          }
          finished = true;
          resolve(db);
        };

        const request = options.version === undefined
          ? indexedDB.open(DB_NAME)
          : indexedDB.open(DB_NAME, options.version);
        let migrationCheck: Promise<void> | null = null;

        request.onerror = () => finishReject(request.error ?? new Error('IndexedDB 打开失败（未知错误）'));
        request.onblocked = () => finishReject(new Error('IndexedDB 打开被阻塞：请关闭相关标签页后重试'));
        request.onsuccess = () => {
          const db = request.result;
          if (finished) {
            try {
              db.close();
            } catch {
              // ignore
            }
            return;
          }
          const finalize = async () => {
            if (migrationCheck) {
              await migrationCheck;
            }

            // Best-effort: avoid blocking future upgrades/deletes.
            db.onversionchange = () => {
              try {
                db.close();
              } finally {
                if (this.db === db) this.db = null;
              }
            };

            finishResolve(db);
          };

          void finalize().catch((err) => {
            try {
              db.close();
            } catch {
              // ignore
            }
            finishReject(err);
          });
        };

        // Only attach migrations when opening with our expected DB_VERSION.
        // When rolling back to an older extension version, the on-disk DB version may be higher,
        // and `indexedDB.open(name, lowerVersion)` fails with VersionError.
        if (!options.allowUpgrade) return;

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = (event.target as IDBOpenDBRequest).transaction;
          if (!tx) return;
          const migrateTasks: Array<Promise<void>> = [];

          // 消息存储
          let msgStore: IDBObjectStore;
          if (!db.objectStoreNames.contains(STORES.messages)) {
            msgStore = db.createObjectStore(STORES.messages, { keyPath: 'id' });
          } else {
            msgStore = tx.objectStore(STORES.messages);
          }
          if (!msgStore.indexNames.contains('contactKey')) {
            msgStore.createIndex('contactKey', 'contactKeyStr', { unique: false });
          }
          if (!msgStore.indexNames.contains('timestamp')) {
            msgStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!msgStore.indexNames.contains('contactKeyTimestamp')) {
            msgStore.createIndex('contactKeyTimestamp', ['contactKeyStr', 'timestamp'], { unique: false });
          }

          // 联系人画像存储
          let profileStore: IDBObjectStore;
          if (!db.objectStoreNames.contains(STORES.profiles)) {
            profileStore = db.createObjectStore(STORES.profiles, { keyPath: 'keyStr' });
          } else {
            profileStore = tx.objectStore(STORES.profiles);
          }

          // 设置存储
          if (!db.objectStoreNames.contains(STORES.settings)) {
            db.createObjectStore(STORES.settings, { keyPath: 'key' });
          }

          // 风格偏好存储
          let stylePrefStore: IDBObjectStore | null = null;
          if (!db.objectStoreNames.contains(STORES.stylePreferences)) {
            stylePrefStore = db.createObjectStore(STORES.stylePreferences, { keyPath: 'contactKeyStr' });
          } else {
            stylePrefStore = tx.objectStore(STORES.stylePreferences);
          }

          // 联系人长期记忆存储
          let memoryStore: IDBObjectStore | null = null;
          if (!db.objectStoreNames.contains(STORES.contactMemories)) {
            memoryStore = db.createObjectStore(STORES.contactMemories, { keyPath: 'contactKeyStr' });
          } else {
            memoryStore = tx.objectStore(STORES.contactMemories);
          }
          if (memoryStore && !memoryStore.indexNames.contains('updatedAt')) {
            memoryStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }

          // 数据迁移：将 legacy key 迁移为转义后的 key，补充新索引字段
          migrateTasks.push(
            this.migrateMessageKeys(msgStore)
          );
          migrateTasks.push(
            this.migrateProfileKeys(profileStore)
          );
          if (stylePrefStore) {
            migrateTasks.push(this.migrateStylePreferenceKeys(stylePrefStore));
          }
          if (memoryStore) {
            migrateTasks.push(this.migrateContactMemoryKeys(memoryStore));
          }

          migrationCheck = Promise.allSettled(migrateTasks).then((results) => {
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
              console.error('[IndexedDBStore] Migration tasks failed', failed);
              throw new Error('IndexedDB 迁移失败');
            }
          });
          // Prevent potential unhandledrejection if the open() itself fails (e.g. transaction abort)
          // before request.onsuccess awaits migrationCheck.
          void migrationCheck.catch(() => {});
        };
      });

    const isVersionError = (e: unknown): boolean =>
      (e instanceof DOMException && e.name === 'VersionError')
      || (e instanceof Error && e.name === 'VersionError');

    try {
      const db = await openDb({ version: DB_VERSION, allowUpgrade: true });
      ensureSchemaCompatible(db);
      this.db = db;
      return;
    } catch (err) {
      if (!isVersionError(err)) throw err;
    }

    // Rollback-safe path: open existing DB at its current version (no migrations).
    const db = await openDb({ allowUpgrade: false });
    ensureSchemaCompatible(db);
    this.db = db;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async saveMessage(message: Message): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const contactKeyStr = contactKeyToString(message.contactKey);
    const record = { ...message, contactKeyStr };

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readwrite');
      const store = tx.objectStore(STORES.messages);
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    // 清理超出上限的历史消息（best-effort，不影响主流程）
    try {
      await this.trimOldMessages(contactKeyStr, MAX_MESSAGES_PER_CONTACT);
    } catch (err) {
      console.warn('[IndexedDBStore] trim messages failed', err);
    }
  }

  /**
   * 删除某个联系人的全部消息（包含历史 key 变体，best-effort）
   */
  async deleteMessages(contactKey: ContactKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const keys = getContactKeyStrCandidates(contactKey);

    for (const keyStr of keys) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORES.messages, 'readwrite');
        const store = tx.objectStore(STORES.messages);
        const index = store.index('contactKey');
        const request = index.openCursor(IDBKeyRange.only(keyStr));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
      });
    }
  }

  async getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]> {
    if (!this.db) throw new Error('Database not initialized');

    const uniqueKeys = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readonly');
      const store = tx.objectStore(STORES.messages);

      // 优先使用复合索引按时间倒序扫描，避免全表扫描
      if (store.indexNames.contains('contactKeyTimestamp')) {
        const index = store.index('contactKeyTimestamp');
        const fetchForKey = (key: string): Promise<Message[]> =>
          new Promise<Message[]>((resolveKey, rejectKey) => {
            const range = IDBKeyRange.bound(
              [key, Number.MIN_SAFE_INTEGER],
              [key, Number.MAX_SAFE_INTEGER]
            );
            const request = index.openCursor(range, 'prev');
            const results: Message[] = [];

            request.onerror = () => rejectKey(request.error);
            request.onsuccess = () => {
              const cursor = request.result;
              if (cursor && results.length < limit) {
                results.push(cursor.value as Message);
                cursor.continue();
                return;
              }
              resolveKey(results);
            };
          });

        Promise.all(uniqueKeys.map(fetchForKey))
          .then((lists) => {
            const merged = lists.flat();
            merged.sort((a, b) => a.timestamp - b.timestamp);
            resolve(merged.slice(-limit));
          })
          .catch((err) => reject(err));
        return;
      }

      // 兜底逻辑：旧索引，仍可能全表扫描
      const index = store.index('contactKey');
      const all: Message[] = [];
      const collectNext = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          all.sort((a, b) => a.timestamp - b.timestamp);
          resolve(all.slice(-limit));
          return;
        }
        const nextKey = remainingKeys.shift()!;
        const request = index.getAll(IDBKeyRange.only(nextKey));

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const messages = request.result as Message[];
          all.push(...messages);
          collectNext(remainingKeys);
        };
      };

      collectNext([...uniqueKeys]);
    });
  }

  async getProfile(contactKey: ContactKey): Promise<ContactProfile | null> {
    if (!this.db) throw new Error('Database not initialized');

    const keysToTry = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readonly');
      const store = tx.objectStore(STORES.profiles);
      const tryNext = (remaining: string[]) => {
        if (remaining.length === 0) {
          resolve(null);
          return;
        }
        const keyStr = remaining.shift()!;
        const request = store.get(keyStr);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const record = request.result;
          if (record) {
            const { keyStr, ...profile } = record as ContactProfile & { keyStr?: string };
            void keyStr;
            resolve(profile as ContactProfile);
            return;
          }
          tryNext(remaining);
        };
      };

      tryNext([...keysToTry]);
    });
  }

  async saveProfile(profile: ContactProfile): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const keyStr = contactKeyToString(profile.key);
    const record = { ...profile, keyStr };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readwrite');
      const store = tx.objectStore(STORES.profiles);
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * 删除联系人的画像（包含历史 key 变体，best-effort）
   */
  async deleteProfile(contactKey: ContactKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const keys = getContactKeyStrCandidates(contactKey);

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readwrite');
      const store = tx.objectStore(STORES.profiles);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const keyStr of keys) {
        store.delete(keyStr);
      }
    });
  }

  async updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>): Promise<void> {
    const existing = await this.getProfile(contactKey);
    if (existing) {
      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      await this.saveProfile(updated);
    }
  }

  /**
   * 获取联系人的消息总数
   */
  async getMessageCount(contactKey: ContactKey): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const keys = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readonly');
      const store = tx.objectStore(STORES.messages);
      const index = store.index('contactKey');
      let total = 0;

      const countNext = (remaining: string[]) => {
        if (remaining.length === 0) {
          resolve(total);
          return;
        }
        const key = remaining.shift()!;
        const request = index.count(IDBKeyRange.only(key));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          total += (request.result as number) || 0;
          countNext(remaining);
        };
      };

      countNext([...keys]);
    });
  }

  /**
   * 获取所有联系人画像
   */
  async getAllProfiles(): Promise<ContactProfile[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readonly');
      const store = tx.objectStore(STORES.profiles);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = request.result;
        const profiles = records.map((record: ContactProfile & { keyStr: string }) => {
          const { keyStr, ...profile } = record;
          void keyStr;
          return profile as ContactProfile;
        });
        resolve(profiles);
      };
    });
  }

  /**
   * 清除指定联系人的所有数据
   */
  async clearContact(contactKey: ContactKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const keys = getContactKeyStrCandidates(contactKey);

    // 删除消息
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readwrite');
      const store = tx.objectStore(STORES.messages);
      const index = store.index(store.indexNames.contains('contactKeyTimestamp') ? 'contactKeyTimestamp' : 'contactKey');

      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const currentKey = remainingKeys.shift()!;
        const range = index.name === 'contactKeyTimestamp'
          ? IDBKeyRange.bound([currentKey, Number.MIN_SAFE_INTEGER], [currentKey, Number.MAX_SAFE_INTEGER])
          : IDBKeyRange.only(currentKey);
        const request = index.openCursor(range);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            deleteNextKey(remainingKeys);
          }
        };
      };

      deleteNextKey([...keys]);
    });

    // 删除画像
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readwrite');
      const store = tx.objectStore(STORES.profiles);
      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const key = remainingKeys.shift()!;
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => deleteNextKey(remainingKeys);
      };

      deleteNextKey([...keys]);
    });

    // 删除风格偏好
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readwrite');
      const store = tx.objectStore(STORES.stylePreferences);
      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const key = remainingKeys.shift()!;
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => deleteNextKey(remainingKeys);
      };

      deleteNextKey([...keys]);
    });

    // 删除长期记忆
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readwrite');
      const store = tx.objectStore(STORES.contactMemories);
      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const key = remainingKeys.shift()!;
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => deleteNextKey(remainingKeys);
      };

      deleteNextKey([...keys]);
    });
  }

  /**
   * 获取联系人的风格偏好
   */
  async getStylePreference(contactKey: ContactKey): Promise<StylePreference | null> {
    if (!this.db) throw new Error('Database not initialized');

    const keysToTry = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readonly');
      const store = tx.objectStore(STORES.stylePreferences);
      const tryNext = (remaining: string[]) => {
        if (remaining.length === 0) {
          resolve(null);
          return;
        }
        const key = remaining.shift()!;
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = (request.result as StylePreference | undefined) ?? null;
          if (result) {
            resolve(result);
            return;
          }
          tryNext(remaining);
        };
      };

      tryNext([...keysToTry]);
    });
  }

  /**
   * 保存联系人的风格偏好
   */
  async saveStylePreference(preference: StylePreference): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readwrite');
      const store = tx.objectStore(STORES.stylePreferences);
      const request = store.put(preference);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * 删除联系人的风格偏好
   */
  async deleteStylePreference(contactKey: ContactKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const keys = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readwrite');
      const store = tx.objectStore(STORES.stylePreferences);
      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const key = remainingKeys.shift()!;
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => deleteNextKey(remainingKeys);
      };

      deleteNextKey([...keys]);
    });
  }

  /**
   * 获取所有风格偏好
   */
  async getAllStylePreferences(): Promise<StylePreference[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readonly');
      const store = tx.objectStore(STORES.stylePreferences);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result as StylePreference[]);
      };
    });
  }

  /**
   * 获取联系人的长期记忆摘要
   */
  async getContactMemorySummary(contactKey: ContactKey): Promise<ContactMemorySummary | null> {
    if (!this.db) throw new Error('Database not initialized');

    const keysToTry = getContactKeyStrCandidates(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readonly');
      const store = tx.objectStore(STORES.contactMemories);
      const tryNext = (remaining: string[]) => {
        if (remaining.length === 0) {
          resolve(null);
          return;
        }
        const key = remaining.shift()!;
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = (request.result as ContactMemorySummary | undefined) ?? null;
          if (result) {
            resolve(result);
            return;
          }
          tryNext(remaining);
        };
      };

      tryNext([...keysToTry]);
    });
  }

  /**
   * 保存联系人的长期记忆摘要
   */
  async saveContactMemorySummary(contactKey: ContactKey, summary: string): Promise<ContactMemorySummary> {
    if (!this.db) throw new Error('Database not initialized');

    const record: ContactMemorySummary = {
      contactKeyStr: contactKeyToString(contactKey),
      summary,
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readwrite');
      const store = tx.objectStore(STORES.contactMemories);
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    return record;
  }

  /**
   * Upsert a contact memory summary record (used for backup/restore flows).
   * Preserves the provided `updatedAt` and normalizes legacy key variants to v2.
   */
  async saveContactMemorySummaryRecord(record: ContactMemorySummary): Promise<ContactMemorySummary> {
    if (!this.db) throw new Error('Database not initialized');

    const normalized: ContactMemorySummary = {
      contactKeyStr: normalizeContactKeyStr(record.contactKeyStr),
      summary: record.summary,
      updatedAt: record.updatedAt,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readwrite');
      const store = tx.objectStore(STORES.contactMemories);
      const request = store.put(normalized);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    return normalized;
  }

  /**
   * 删除联系人的长期记忆摘要
   */
  async deleteContactMemorySummary(contactKey: ContactKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const keys = getContactKeyStrCandidates(contactKey);

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readwrite');
      const store = tx.objectStore(STORES.contactMemories);
      const deleteNextKey = (remainingKeys: string[]) => {
        if (remainingKeys.length === 0) {
          resolve();
          return;
        }
        const key = remainingKeys.shift()!;
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => deleteNextKey(remainingKeys);
      };

      deleteNextKey([...keys]);
    });
  }

  /**
   * 获取所有联系人长期记忆摘要
   */
  async getAllContactMemorySummaries(): Promise<ContactMemorySummary[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.contactMemories, 'readonly');
      const store = tx.objectStore(STORES.contactMemories);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as ContactMemorySummary[]);
    });
  }

  /**
   * Export a portable snapshot of *derived* user data (no raw message contents).
   */
  async exportSnapshot(): Promise<IndexedDBSnapshotV1> {
    if (!this.db) throw new Error('Database not initialized');

    const [profiles, stylePreferences, contactMemories] = await Promise.all([
      this.getAllProfiles(),
      this.getAllStylePreferences(),
      this.getAllContactMemorySummaries(),
    ]);

    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      profiles,
      stylePreferences,
      contactMemories,
    };
  }

  /**
   * Import a snapshot previously produced by exportSnapshot().
   *
   * This is best-effort: invalid records are skipped, valid records are upserted.
   */
  async importSnapshot(snapshot: IndexedDBSnapshotV1): Promise<{
    imported: { profiles: number; stylePreferences: number; contactMemories: number };
    skipped: { profiles: number; stylePreferences: number; contactMemories: number };
  }> {
    if (!this.db) throw new Error('Database not initialized');
    if (!snapshot || snapshot.schemaVersion !== 1) {
      throw new Error('Unsupported snapshot schema version');
    }

    const incomingProfiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
    const incomingStylePreferences = Array.isArray(snapshot.stylePreferences) ? snapshot.stylePreferences : [];
    const incomingContactMemories = Array.isArray(snapshot.contactMemories) ? snapshot.contactMemories : [];

    const profiles: ContactProfile[] = [];
    let skippedProfiles = 0;
    for (const raw of incomingProfiles) {
      const profile = sanitizeContactProfile(raw);
      if (profile) profiles.push(profile);
      else skippedProfiles += 1;
    }

    const stylePreferences: StylePreference[] = [];
    let skippedStylePreferences = 0;
    for (const raw of incomingStylePreferences) {
      const pref = sanitizeStylePreference(raw);
      if (pref) stylePreferences.push(pref);
      else skippedStylePreferences += 1;
    }

    const contactMemories: ContactMemorySummary[] = [];
    let skippedContactMemories = 0;
    for (const raw of incomingContactMemories) {
      const mem = sanitizeContactMemorySummary(raw);
      if (mem) contactMemories.push(mem);
      else skippedContactMemories += 1;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([STORES.profiles, STORES.stylePreferences, STORES.contactMemories], 'readwrite');
      const profileStore = tx.objectStore(STORES.profiles);
      const stylePrefStore = tx.objectStore(STORES.stylePreferences);
      const memoryStore = tx.objectStore(STORES.contactMemories);

      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        try {
          tx.abort();
        } catch {
          // ignore
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = () => fail(tx.error ?? new Error('Snapshot import failed'));
      tx.onabort = () => fail(tx.error ?? new Error('Snapshot import aborted'));

      for (const profile of profiles) {
        const keyStr = contactKeyToString(profile.key);
        const request = profileStore.put({ ...profile, keyStr });
        request.onerror = () => fail(request.error);
      }

      for (const pref of stylePreferences) {
        const request = stylePrefStore.put(pref);
        request.onerror = () => fail(request.error);
      }

      for (const memory of contactMemories) {
        const request = memoryStore.put(memory);
        request.onerror = () => fail(request.error);
      }
    });

    return {
      imported: {
        profiles: profiles.length,
        stylePreferences: stylePreferences.length,
        contactMemories: contactMemories.length,
      },
      skipped: {
        profiles: skippedProfiles,
        stylePreferences: skippedStylePreferences,
        contactMemories: skippedContactMemories,
      },
    };
  }

  /**
   * 迁移消息记录中的 contactKeyStr，确保使用转义后的 key
   */
  private migrateMessageKeys(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as Message & { contactKeyStr?: string };
        const desiredKey = contactKeyToString(record.contactKey);
        if (record.contactKeyStr !== desiredKey) {
          const updated = { ...record, contactKeyStr: desiredKey };
          const updateRequest = cursor.update(updated);
          updateRequest.onerror = () => reject(updateRequest.error);
          updateRequest.onsuccess = () => cursor.continue();
        } else {
          cursor.continue();
        }
      };
    });
  }

  /**
   * 迁移画像记录的 key（keyPath = keyStr）
   */
  private migrateProfileKeys(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as ContactProfile & { keyStr: string };
        const desiredKey = contactKeyToString(record.key);
        if (record.keyStr === desiredKey) {
          cursor.continue();
          return;
        }

        const updated = { ...record, keyStr: desiredKey };
        const existingRequest = store.get(desiredKey);
        existingRequest.onerror = () => reject(existingRequest.error);
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as (ContactProfile & { keyStr: string }) | undefined;
          const merged = existing ? mergeProfiles(existing, updated, desiredKey) : updated;

          const deleteRequest = cursor.delete();
          deleteRequest.onerror = () => reject(deleteRequest.error);
          deleteRequest.onsuccess = () => {
            const putRequest = store.put(merged);
            putRequest.onerror = () => reject(putRequest.error);
            putRequest.onsuccess = () => cursor.continue();
          };
        };
      };
    });
  }

  /**
   * 迁移风格偏好记录的 key（keyPath = contactKeyStr）
   */
  private migrateStylePreferenceKeys(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as StylePreference & { contactKeyStr?: unknown };
        const currentKey = typeof record.contactKeyStr === 'string' ? record.contactKeyStr : String(cursor.key);
        const desiredKey = normalizeContactKeyStr(currentKey);
        if (desiredKey === currentKey) {
          cursor.continue();
          return;
        }

        const updated: StylePreference = { ...(record as StylePreference), contactKeyStr: desiredKey };
        const existingRequest = store.get(desiredKey);
        existingRequest.onerror = () => reject(existingRequest.error);
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as StylePreference | undefined;
          const merged = existing ? mergeStylePreferences(existing, updated, desiredKey) : updated;

          const deleteRequest = cursor.delete();
          deleteRequest.onerror = () => reject(deleteRequest.error);
          deleteRequest.onsuccess = () => {
            const putRequest = store.put(merged);
            putRequest.onerror = () => reject(putRequest.error);
            putRequest.onsuccess = () => cursor.continue();
          };
        };
      };
    });
  }

  /**
   * 迁移长期记忆记录的 key（keyPath = contactKeyStr）
   */
  private migrateContactMemoryKeys(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as ContactMemorySummary & { contactKeyStr?: unknown };
        const currentKey = typeof record.contactKeyStr === 'string' ? record.contactKeyStr : String(cursor.key);
        const desiredKey = normalizeContactKeyStr(currentKey);
        if (desiredKey === currentKey) {
          cursor.continue();
          return;
        }

        const updated: ContactMemorySummary = { ...(record as ContactMemorySummary), contactKeyStr: desiredKey };
        const existingRequest = store.get(desiredKey);
        existingRequest.onerror = () => reject(existingRequest.error);
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as ContactMemorySummary | undefined;
          const merged = existing ? mergeContactMemories(existing, updated, desiredKey) : updated;

          const deleteRequest = cursor.delete();
          deleteRequest.onerror = () => reject(deleteRequest.error);
          deleteRequest.onsuccess = () => {
            const putRequest = store.put(merged);
            putRequest.onerror = () => reject(putRequest.error);
            putRequest.onsuccess = () => cursor.continue();
          };
        };
      };
    });
  }

  /**
   * 删除整个 IndexedDB 数据库（用于彻底清除数据）
   */
  async deleteDatabase(): Promise<void> {
    // 关闭现有连接，避免阻塞删除
    this.db?.close();
    this.db = null;

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      request.onblocked = () => reject(new Error('Database deletion blocked'));
    });
  }

  /**
   * 清理超出上限的旧消息
   */
  private async trimOldMessages(contactKeyStr: string, maxCount: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction(STORES.messages, 'readwrite');
    const store = tx.objectStore(STORES.messages);
    const indexName = store.indexNames.contains('contactKeyTimestamp') ? 'contactKeyTimestamp' : 'contactKey';
    const index = store.index(indexName);

    const range = indexName === 'contactKeyTimestamp'
      ? IDBKeyRange.bound([contactKeyStr, Number.MIN_SAFE_INTEGER], [contactKeyStr, Number.MAX_SAFE_INTEGER])
      : IDBKeyRange.only(contactKeyStr);

    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(range, 'prev');
      let count = 0;

      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        count += 1;
        if (count > maxCount) {
          cursor.delete();
        }
        cursor.continue();
      };
    });
  }
}
