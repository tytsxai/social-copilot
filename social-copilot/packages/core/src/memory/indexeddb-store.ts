import type { Message, ContactProfile, ContactKey, StylePreference } from '../types';
import type { MemoryStore } from './store';
import { contactKeyToString } from '../types/contact';

const DB_NAME = 'social-copilot';
const DB_VERSION = 2;

const STORES = {
  messages: 'messages',
  profiles: 'profiles',
  settings: 'settings',
  stylePreferences: 'stylePreferences',
} as const;

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

        // 消息存储
        if (!db.objectStoreNames.contains(STORES.messages)) {
          const msgStore = db.createObjectStore(STORES.messages, { keyPath: 'id' });
          msgStore.createIndex('contactKey', 'contactKeyStr', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 联系人画像存储
        if (!db.objectStoreNames.contains(STORES.profiles)) {
          db.createObjectStore(STORES.profiles, { keyPath: 'keyStr' });
        }

        // 设置存储
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }

        // 风格偏好存储
        if (!db.objectStoreNames.contains(STORES.stylePreferences)) {
          db.createObjectStore(STORES.stylePreferences, { keyPath: 'contactKeyStr' });
        }
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readwrite');
      const store = tx.objectStore(STORES.messages);
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]> {
    if (!this.db) throw new Error('Database not initialized');

    const contactKeyStr = contactKeyToString(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readonly');
      const store = tx.objectStore(STORES.messages);
      const index = store.index('contactKey');
      const request = index.getAll(IDBKeyRange.only(contactKeyStr));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const messages = request.result as Message[];
        // 按时间排序，取最近 N 条
        messages.sort((a, b) => a.timestamp - b.timestamp);
        resolve(messages.slice(-limit));
      };
    });
  }

  async getProfile(contactKey: ContactKey): Promise<ContactProfile | null> {
    if (!this.db) throw new Error('Database not initialized');

    const keyStr = contactKeyToString(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readonly');
      const store = tx.objectStore(STORES.profiles);
      const request = store.get(keyStr);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          const { keyStr: _, ...profile } = record;
          resolve(profile as ContactProfile);
        } else {
          resolve(null);
        }
      };
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

    const contactKeyStr = contactKeyToString(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readonly');
      const store = tx.objectStore(STORES.messages);
      const index = store.index('contactKey');
      const request = index.count(IDBKeyRange.only(contactKeyStr));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
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
          const { keyStr: _, ...profile } = record;
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

    const contactKeyStr = contactKeyToString(contactKey);

    // 删除消息
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.messages, 'readwrite');
      const store = tx.objectStore(STORES.messages);
      const index = store.index('contactKey');
      const request = index.openCursor(IDBKeyRange.only(contactKeyStr));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // 删除画像
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORES.profiles, 'readwrite');
      const store = tx.objectStore(STORES.profiles);
      const request = store.delete(contactKeyStr);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * 获取联系人的风格偏好
   */
  async getStylePreference(contactKey: ContactKey): Promise<StylePreference | null> {
    if (!this.db) throw new Error('Database not initialized');

    const contactKeyStr = contactKeyToString(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readonly');
      const store = tx.objectStore(STORES.stylePreferences);
      const request = store.get(contactKeyStr);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result as StylePreference | null);
      };
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

    const contactKeyStr = contactKeyToString(contactKey);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.stylePreferences, 'readwrite');
      const store = tx.objectStore(STORES.stylePreferences);
      const request = store.delete(contactKeyStr);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
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
}
