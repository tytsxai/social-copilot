import type { ContactKey } from './contact';

/**
 * 消息方向
 */
export type MessageDirection = 'incoming' | 'outgoing';

/**
 * 单条消息
 * @security UNTRUSTED - Must be HTML-escaped before rendering.
 * URLs must be validated with safeUrl() before use in href/src.
 */
export interface Message {
  /** 消息ID（平台提供或自动生成） */
  id: string;
  /** 所属会话 */
  contactKey: ContactKey;
  /** 消息方向 */
  direction: MessageDirection;
  /** 发送者名称 */
  senderName: string;
  /** 消息文本内容 */
  text: string;
  /** 时间戳 */
  timestamp: number;
  /** 原始数据（用于调试） */
  raw?: unknown;
}

/**
 * 对话上下文（用于 LLM 输入）
 */
export interface ConversationContext {
  /** 联系人信息 */
  contactKey: ContactKey;
  /** 最近消息列表（按时间升序） */
  recentMessages: Message[];
  /** 当前待回复的消息 */
  currentMessage: Message;
}
