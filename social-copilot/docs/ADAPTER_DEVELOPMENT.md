# 平台适配器开发指南

本文档介绍如何为 Social Copilot 开发新的聊天平台适配器。

## 目录

- [架构概述](#架构概述)
- [基类接口](#基类接口)
- [必须实现的方法](#必须实现的方法)
- [选择器配置](#选择器配置)
- [消息提取模式](#消息提取模式)
- [添加新平台示例](#添加新平台示例)
- [测试与调试](#测试与调试)

## 架构概述

适配器层负责将不同聊天平台的 DOM 结构抽象为统一的数据接口。

```
┌─────────────────────────────────────────────────────┐
│                  Content Script                      │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Telegram   │  │  WhatsApp   │  │    Slack    │  │
│  │  Adapter    │  │  Adapter    │  │   Adapter   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │         │
│         └────────────────┼────────────────┘         │
│                          ▼                          │
│              ┌───────────────────┐                  │
│              │  PlatformAdapter  │                  │
│              │    (Interface)    │                  │
│              └───────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

**文件结构**:
```
packages/browser-extension/src/adapters/
├── base.ts          # 基类接口与工具函数
├── telegram.ts      # Telegram Web 适配器
├── whatsapp.ts      # WhatsApp Web 适配器
├── slack.ts         # Slack Web 适配器
└── index.ts         # 适配器注册与导出
```

## 基类接口

所有适配器必须实现 `PlatformAdapter` 接口：

```typescript
// packages/browser-extension/src/adapters/base.ts:16-40

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

  /** 可选：运行时诊断信息 */
  getRuntimeInfo?(): AdapterRuntimeInfo;
}
```

### ContactKey 结构

```typescript
interface ContactKey {
  platform: 'web' | 'windows' | 'mac' | 'android' | 'ios';
  app: 'telegram' | 'whatsapp' | 'slack' | 'discord' | 'wechat' | 'other';
  accountId?: string;      // 当前登录账号 ID
  conversationId: string;  // 会话唯一标识
  peerId: string;          // 对方显示名称
  isGroup: boolean;        // 是否群聊
}
```

## 必须实现的方法

### 1. isMatch()

检测当前页面是否属于该平台。

```typescript
isMatch(): boolean {
  // 方式1: 检查 URL
  return window.location.hostname.includes('web.telegram.org');

  // 方式2: 检查特征 DOM 元素
  return document.querySelector('.telegram-app') !== null;
}
```

### 2. extractContactKey()

提取当前会话的联系人标识。

```typescript
extractContactKey(): ContactKey | null {
  const chatHeader = document.querySelector('.chat-header');
  if (!chatHeader) return null;

  return {
    platform: 'web',
    app: 'telegram',
    conversationId: this.extractConversationId(),
    peerId: chatHeader.textContent?.trim() || 'Unknown',
    isGroup: this.detectIsGroup(),
  };
}
```

### 3. extractMessages(limit)

提取最近的消息列表。

```typescript
extractMessages(limit: number): Message[] {
  const messageElements = document.querySelectorAll('.message');
  const messages: Message[] = [];

  // 从最新消息开始，倒序遍历
  const elements = Array.from(messageElements).slice(-limit);

  for (const el of elements) {
    const message = this.parseMessageElement(el);
    if (message) messages.push(message);
  }

  return messages;
}
```

### 4. getInputElement()

获取消息输入框元素。

```typescript
getInputElement(): HTMLElement | null {
  return document.querySelector(
    '.message-input, [contenteditable="true"]'
  );
}
```

### 5. fillInput(text)

填充文本到输入框，需要触发正确的事件。

```typescript
fillInput(text: string): boolean {
  const input = this.getInputElement();
  if (!input) return false;

  // 使用工具函数设置文本
  const success = setEditableText(input, text);
  if (!success) return false;

  // 触发 input 事件通知框架
  dispatchInputLikeEvent(input, text);
  return true;
}
```

### 6. onNewMessage(callback)

监听新消息，返回取消监听的函数。

```typescript
onNewMessage(callback: (message: Message) => void): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && node.matches('.message')) {
          const message = this.parseMessageElement(node);
          if (message) callback(message);
        }
      }
    }
  });

  const container = document.querySelector('.messages-container');
  if (container) {
    observer.observe(container, { childList: true, subtree: true });
  }

  return () => observer.disconnect();
}
```

## 选择器配置

### 多选择器优先级

使用 `queryFirst` 工具函数支持多个选择器候选：

```typescript
import { queryFirst } from './base';

// 按优先级尝试多个选择器
const result = queryFirst<HTMLElement>([
  '.new-chat-header',      // 新版 UI
  '.chat-info-header',     // 旧版 UI
  '[data-testid="header"]' // 测试环境
]);

if (result) {
  console.log('匹配的选择器:', result.selector);
  console.log('元素:', result.element);
}
```

### 远程选择器配置

支持从远程加载选择器配置，应对平台 UI 更新：

```typescript
// 选择器配置结构
interface SelectorConfig {
  chatContainer: string;
  messageItem: string;
  messageText: string;
  inputBox: string;
  sendButton?: string;
}

// 合并本地与远程配置
const selectors = {
  ...DEFAULT_SELECTORS,
  ...remoteConfig?.selectors,
};
```

## 消息提取模式

### 消息 ID 生成

使用 `buildMessageId` 确保 ID 稳定且唯一：

```typescript
import { buildMessageId } from './base';

const messageId = buildMessageId({
  preferredId: el.dataset.messageId,  // 平台提供的 ID（优先）
  contactKey,
  direction: 'incoming',
  senderName: 'Alice',
  text: 'Hello!',
  timeText: '10:30 AM',
});
// 输出: "telegram|web|conv123::msg456" 或 "telegram|web|conv123::f_abc123"
```

### 时间戳解析

使用 `parseTimestampFromText` 解析各种时间格式：

```typescript
import { parseTimestampFromText } from './base';

// 支持的格式
parseTimestampFromText('10:30 AM');        // 今天 10:30
parseTimestampFromText('Yesterday 3:00 PM'); // 昨天 15:00
parseTimestampFromText('2024-01-15');      // 指定日期
parseTimestampFromText('1月15日 14:30');   // 中文格式
```

## 添加新平台示例

以 Discord 为例：

```typescript
// packages/browser-extension/src/adapters/discord.ts

import type { Message, ContactKey } from '@social-copilot/core';
import type { PlatformAdapter } from './base';
import {
  queryFirst,
  buildMessageId,
  parseTimestampFromText,
  setEditableText,
  dispatchInputLikeEvent
} from './base';

const SELECTORS = {
  chatContainer: '[class*="chatContent"]',
  messageItem: '[class*="message-"]',
  messageText: '[class*="messageContent"]',
  inputBox: '[class*="textArea"] [contenteditable="true"]',
};

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const;

  isMatch(): boolean {
    return window.location.hostname === 'discord.com';
  }

  extractContactKey(): ContactKey | null {
    // 从 URL 提取频道 ID: /channels/server/channel
    const match = window.location.pathname.match(/\/channels\/(\d+)\/(\d+)/);
    if (!match) return null;

    const channelName = document.querySelector('[class*="title-"]')?.textContent;

    return {
      platform: 'web',
      app: 'discord',
      conversationId: `${match[1]}-${match[2]}`,
      peerId: channelName?.trim() || 'Unknown',
      isGroup: true, // Discord 频道默认为群聊
    };
  }

  extractMessages(limit: number): Message[] {
    const contactKey = this.extractContactKey();
    if (!contactKey) return [];

    const elements = document.querySelectorAll(SELECTORS.messageItem);
    const messages: Message[] = [];

    const slice = Array.from(elements).slice(-limit);
    for (const el of slice) {
      const text = el.querySelector(SELECTORS.messageText)?.textContent;
      if (!text) continue;

      const sender = el.querySelector('[class*="username"]')?.textContent || 'Unknown';
      const time = el.querySelector('time')?.getAttribute('datetime');

      messages.push({
        id: buildMessageId({
          preferredId: el.id,
          contactKey,
          direction: 'incoming',
          senderName: sender,
          text,
        }),
        contactKey,
        direction: 'incoming',
        text,
        timestamp: time ? new Date(time).getTime() : Date.now(),
        senderName: sender,
      });
    }

    return messages;
  }

  getInputElement(): HTMLElement | null {
    return queryFirst<HTMLElement>(SELECTORS.inputBox)?.element || null;
  }

  fillInput(text: string): boolean {
    const input = this.getInputElement();
    if (!input) return false;

    const success = setEditableText(input, text);
    if (success) dispatchInputLikeEvent(input, text);
    return success;
  }

  onNewMessage(callback: (message: Message) => void): () => void {
    const container = document.querySelector(SELECTORS.chatContainer);
    if (!container) return () => {};

    const observer = new MutationObserver(() => {
      // 简化实现：检测新消息
    });

    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
}
```

### 注册适配器

```typescript
// packages/browser-extension/src/adapters/index.ts

import { DiscordAdapter } from './discord';

export const adapters: PlatformAdapter[] = [
  new TelegramAdapter(),
  new WhatsAppAdapter(),
  new SlackAdapter(),
  new DiscordAdapter(), // 添加新适配器
];

export function detectAdapter(): PlatformAdapter | null {
  return adapters.find(adapter => adapter.isMatch()) || null;
}
```

## 测试与调试

### 开发调试

1. **启用调试模式**:
```typescript
// 在控制台设置
localStorage.setItem('social-copilot-debug', 'true');
```

2. **检查适配器匹配**:
```typescript
// 控制台测试
const adapter = detectAdapter();
console.log('当前适配器:', adapter?.platform);
console.log('联系人:', adapter?.extractContactKey());
console.log('消息:', adapter?.extractMessages(10));
```

### 运行时诊断

实现 `getRuntimeInfo()` 提供诊断信息：

```typescript
getRuntimeInfo(): AdapterRuntimeInfo {
  return {
    variant: this.detectedVariant,
    selectorHints: {
      chatContainer: this.matchedSelectors.container,
      message: this.matchedSelectors.message,
      inputBox: this.matchedSelectors.input,
    },
  };
}
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 消息提取为空 | 选择器过时 | 更新选择器或使用远程配置 |
| 输入框填充无效 | 事件未触发 | 使用 `dispatchInputLikeEvent` |
| 消息 ID 重复 | 缺少唯一标识 | 使用 `buildMessageId` 生成稳定 ID |
| 时间戳解析错误 | 格式不支持 | 扩展 `parseTimestampFromText` |

---

**相关文档**:
- [架构设计](./ARCHITECTURE.md)
- [扩展协议](./EXTENSION_PROTOCOL.md)
- [开发指南](./DEVELOPMENT.md)
