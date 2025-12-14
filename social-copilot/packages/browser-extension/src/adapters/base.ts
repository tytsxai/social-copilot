import type { Message, ContactKey } from '@social-copilot/core';
import { contactKeyToString } from '@social-copilot/core';

export interface AdapterRuntimeInfo {
  /** Adapter layout/version variant selected at runtime */
  variant?: string;
  /** Which selectors actually matched on the current page */
  selectorHints?: Partial<Record<'chatContainer' | 'message' | 'inputBox', string>>;
}

/**
 * 平台适配器接口
 * 每个聊天平台实现一个适配器
 */
export interface PlatformAdapter {
  /** 平台标识 */
  readonly platform: ContactKey['app'];
  
  /** 检查当前页面是否匹配此适配器 */
  isMatch(): boolean;
  
  /** 提取当前会话的联系人信息 */
  extractContactKey(): ContactKey | null;
  
  /** 提取最近的消息列表 */
  extractMessages(limit: number): Message[];
  
  /** 获取输入框元素 */
  getInputElement(): HTMLElement | null;
  
  /** 填充文本到输入框 */
  fillInput(text: string): boolean;
  
  /** 监听新消息 */
  onNewMessage(callback: (message: Message) => void): () => void;

  /** Optional runtime information for diagnostics */
  getRuntimeInfo?(): AdapterRuntimeInfo;
}

export function splitSelectors(selectors: string): string[] {
  return selectors
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function queryFirst<T extends Element = Element>(
  selectors: string | string[],
  root: ParentNode = document
): { element: T; selector: string } | null {
  const list = Array.isArray(selectors) ? selectors : splitSelectors(selectors);
  for (const selector of list) {
    const el = root.querySelector(selector);
    if (el) return { element: el as T, selector };
  }
  return null;
}

/**
 * 生成一个可预测的短 hash（32-bit）用于构造稳定 ID
 */
function hashString(input: string): string {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // unsigned -> base36
  return (hash >>> 0).toString(36);
}

export function buildMessageId(args: {
  preferredId?: string | null;
  contactKey: ContactKey;
  direction: Message['direction'];
  senderName: string;
  text: string;
  timeText?: string;
}): string {
  const contactKeyStr = contactKeyToString(args.contactKey);
  const preferred = typeof args.preferredId === 'string' ? args.preferredId.trim() : '';
  if (preferred) {
    return `${contactKeyStr}::${preferred}`;
  }

  const raw = [
    args.direction,
    args.senderName,
    (args.timeText ?? '').trim(),
    args.text,
  ].join('|');
  const stable = hashString(`${contactKeyStr}|${raw}`);
  return `${contactKeyStr}::f_${stable}`;
}

export function parseTimestampFromText(timeText: string, now: Date = new Date()): number {
  const text = (timeText ?? '').trim();
  if (!text) return Date.now();

  const base = new Date(now.getTime());

  if (/yesterday/i.test(text) || text.includes('昨天')) {
    base.setDate(base.getDate() - 1);
  }

  // Date patterns
  const ymd = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    base.setFullYear(year, month, day);
  } else {
    const mdy = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (mdy) {
      const month = parseInt(mdy[1], 10) - 1;
      const day = parseInt(mdy[2], 10);
      const year = parseInt(mdy[3], 10);
      base.setFullYear(year, month, day);
    } else {
      const mdZh = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      const md = mdZh || text.match(/(\d{1,2})[./-](\d{1,2})/);
      if (md) {
        const month = parseInt(md[1], 10) - 1;
        const day = parseInt(md[2], 10);
        base.setMonth(month, day);
      }
    }
  }

  // Time patterns
  const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM|上午|下午)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const suffix = (timeMatch[3] || '').toUpperCase();

    if (suffix === 'PM' || suffix === '下午') {
      if (hours !== 12) hours += 12;
    } else if (suffix === 'AM' || suffix === '上午') {
      if (hours === 12) hours = 0;
    }

    base.setHours(hours, minutes, 0, 0);
    return base.getTime();
  }

  return Date.now();
}
