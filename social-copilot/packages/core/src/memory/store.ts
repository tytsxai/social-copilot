import type { Message, ContactProfile, ContactKey } from '../types';
import { contactKeyToString } from '../types/contact';

/**
 * 记忆存储接口
 */
export interface MemoryStore {
  // 消息存储
  saveMessage(message: Message): Promise<void>;
  getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]>;
  
  // 联系人画像
  getProfile(contactKey: ContactKey): Promise<ContactProfile | null>;
  saveProfile(profile: ContactProfile): Promise<void>;
  updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>): Promise<void>;
  
  // 初始化与清理
  init(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 内存存储实现（MVP 用，后续替换为 SQLite）
 */
export class InMemoryStore implements MemoryStore {
  private messages: Map<string, Message[]> = new Map();
  private profiles: Map<string, ContactProfile> = new Map();

  async init(): Promise<void> {
    // 内存存储无需初始化
  }

  async close(): Promise<void> {
    this.messages.clear();
    this.profiles.clear();
  }

  async saveMessage(message: Message): Promise<void> {
    const key = contactKeyToString(message.contactKey);
    const list = this.messages.get(key) || [];
    list.push(message);
    // 保留最近 100 条
    if (list.length > 100) {
      list.shift();
    }
    this.messages.set(key, list);
  }

  async getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]> {
    const key = contactKeyToString(contactKey);
    const list = this.messages.get(key) || [];
    return list.slice(-limit);
  }

  async getProfile(contactKey: ContactKey): Promise<ContactProfile | null> {
    const key = contactKeyToString(contactKey);
    return this.profiles.get(key) || null;
  }

  async saveProfile(profile: ContactProfile): Promise<void> {
    const key = contactKeyToString(profile.key);
    this.profiles.set(key, profile);
  }

  async updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>): Promise<void> {
    const key = contactKeyToString(contactKey);
    const existing = this.profiles.get(key);
    if (existing) {
      this.profiles.set(key, { ...existing, ...updates, updatedAt: Date.now() });
    }
  }
}
