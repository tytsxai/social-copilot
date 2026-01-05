# 存储层与数据迁移指南

本文档介绍 Social Copilot 的 IndexedDB 存储架构及数据迁移策略。

## 目录

- [存储架构](#存储架构)
- [数据库版本管理](#数据库版本管理)
- [对象存储结构](#对象存储结构)
- [向后兼容性](#向后兼容性)
- [数据迁移](#数据迁移)
- [存储限制与清理](#存储限制与清理)
- [导出导入接口](#导出导入接口)

## 存储架构

```
┌─────────────────────────────────────────────────────┐
│              IndexedDB: social-copilot              │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  messages   │  │  profiles   │  │  settings   │  │
│  │  (消息)     │  │  (画像)     │  │  (设置)     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   style     │  │  contact    │  │  thought    │  │
│  │ Preferences │  │  Memories   │  │ Preferences │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
```

**核心文件**: `packages/core/src/memory/indexeddb-store.ts`

### 配置常量

```typescript
const DB_NAME = 'social-copilot';
const DB_VERSION = 7;
const MAX_MESSAGES_PER_CONTACT = 2000;
const MAX_TOTAL_MESSAGES = 50000;
```

## 数据库版本管理

当前版本: **7**

| 版本 | 变更内容 |
|------|----------|
| 1 | 初始 messages, profiles 存储 |
| 2 | 添加 settings 存储 |
| 3 | 添加 stylePreferences 存储 |
| 4 | 添加 contactMemories 存储 |
| 5 | 添加 contactKeyTimestamp 复合索引 |
| 6 | 添加 thoughtPreferences 存储 |
| 7 | ContactKey 格式迁移 |

## 对象存储结构

### messages 存储

```typescript
// keyPath: 'id'
// 索引: contactKey, timestamp, contactKeyTimestamp

interface MessageRecord {
  id: string;              // 消息唯一 ID
  contactKeyStr: string;   // 联系人标识字符串
  contactKey: ContactKey;  // 联系人结构
  direction: 'incoming' | 'outgoing';
  text: string;
  timestamp: number;
  senderName?: string;
}
```

### profiles 存储

```typescript
// keyPath: 'keyStr'

interface ProfileRecord {
  keyStr: string;
  key: ContactKey;
  displayName: string;
  interests?: string[];
  relationshipType?: 'friend' | 'colleague' | 'family' | 'other';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
```

### stylePreferences 存储

```typescript
// keyPath: 'contactKeyStr'

interface StylePreference {
  contactKeyStr: string;
  styleHistory: Array<{
    style: ReplyStyle;
    count: number;
    lastUsed: number;
  }>;
  defaultStyle: ReplyStyle | null;
  updatedAt: number;
}
```

### contactMemories 存储

```typescript
// keyPath: 'contactKeyStr'

interface ContactMemorySummary {
  contactKeyStr: string;
  summary: string;      // 长期记忆摘要
  updatedAt: number;
}
```

### thoughtPreferences 存储

```typescript
// keyPath: 'contactKeyStr'

interface ThoughtPreference {
  contactKeyStr: string;
  thoughtHistory: Array<{
    thought: ThoughtType;
    count: number;
    lastUsed: number;
  }>;
  defaultThought: ThoughtType | null;
  updatedAt: number;
}
```

## 向后兼容性

读取数据时自动尝试多个 ContactKey 变体，确保旧数据可访问。

## 存储限制与清理

| 限制项 | 默认值 |
|--------|--------|
| 单联系人消息上限 | 2000 条 |
| 全局消息上限 | 50000 条 |

## 导出导入接口

```typescript
const snapshot = await store.exportSnapshot();
await store.importSnapshot(snapshot);
```

---

**相关文档**: [架构设计](./ARCHITECTURE.md)
