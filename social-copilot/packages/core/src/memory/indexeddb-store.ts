import type { Message, ContactProfile, ContactKey, StylePreference, ReplyStyle } from '../types';
import type { MemoryStore } from './store';
import { contactKeyToString, contactKeyToStringV1, legacyContactKeyToString, normalizeContactKeyStr } from '../types/contact';

const DB_NAME = 'social-copilot';
const DB_VERSION = 6;
const MAX_MESSAGES_PER_CONTACT = 2000;

const STORES = {
  messages: 'messages',
  profiles: 'profiles',
  settings: 'settings',
  stylePreferences: 'stylePreferences',
  contactMemories: 'contactMemories',
} as const;

export interface ContactMemorySummary {
  contactKeyStr: string;
  summary: string;
  updatedAt: number;
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

/**
 * IndexedDB 存储实现
 */
export class IndexedDBStore implements MemoryStore {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

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

        tx.oncomplete = () => {
          Promise.allSettled(migrateTasks).then((results) => {
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
              console.error('[IndexedDBStore] Migration tasks failed', failed);
              // 迁移失败时抛出，让 init 失败以便上层提示用户
              reject(new Error('IndexedDB migration failed'));
            }
          }).catch((err) => {
            console.error('[IndexedDBStore] Migration tasks error', err);
            reject(err);
          });
        };
      };
    });
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
