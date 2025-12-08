import type { Message, ContactKey } from '@social-copilot/core';

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
}

/**
 * 生成消息 ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
