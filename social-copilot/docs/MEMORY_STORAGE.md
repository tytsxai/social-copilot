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

### ContactKey 变体机制

`getContactKeyStrCandidates()` 函数生成所有可能的 key 变体：

```typescript
// 示例：对于 WhatsApp 联系人
const contactKey = {
  platform: 'web',
  app: 'whatsapp',
  accountId: 'user123',
  conversationId: 'chat456',
  peerId: 'Alice',
  isGroup: false,
};

// 生成的候选 key 列表：
// 1. 当前格式: "web|whatsapp|user123|chat456|0"
// 2. 无 accountId: "web|whatsapp||chat456|0"
// 3. V1 格式: "web:whatsapp:user123:chat456:0"
// 4. Legacy 格式: "whatsapp_chat456"
```

### 数据读取流程

```
查询请求 → 生成候选 key 列表 → 依次尝试查询 → 返回首个匹配结果
```

```typescript
async getProfile(contactKey: ContactKey): Promise<ContactProfile | null> {
  const keysToTry = getContactKeyStrCandidates(contactKey);

  for (const keyStr of keysToTry) {
    const result = await store.get(keyStr);
    if (result) return result;
  }
  return null;
}
```

## 存储限制与清理

| 限制项 | 默认值 |
|--------|--------|
| 单联系人消息上限 | 2000 条 |
| 全局消息上限 | 50000 条 |

### 自动清理机制

```typescript
// 配置选项
const store = new IndexedDBStore({
  maxMessagesPerContact: 2000,    // 单联系人上限
  maxTotalMessages: 50000,        // 全局上限
  totalTrimIntervalMs: 300000,    // 全局清理最小间隔 (5分钟)
  totalTrimWriteThreshold: 200,   // 触发清理的写入次数
});
```

**清理触发条件**：
- 单联系人：每次 `saveMessage` 后检查
- 全局：写入次数达到阈值 或 距上次清理超过间隔时间

**清理策略**：按时间戳删除最旧的消息

## 数据迁移

### 版本升级迁移

数据库升级时自动执行迁移任务：

```typescript
// onupgradeneeded 事件中执行
const migrateTasks: Array<Promise<void>> = [];

migrateTasks.push(this.migrateMessageKeys(msgStore, tx));
migrateTasks.push(this.migrateProfileKeys(profileStore, tx));
migrateTasks.push(this.migrateStylePreferenceKeys(stylePrefStore, tx));
migrateTasks.push(this.migrateContactMemoryKeys(memoryStore, tx));

await Promise.allSettled(migrateTasks);
```

### 迁移示例：ContactKey 格式升级

从 V1 格式迁移到 V2 格式：

```typescript
// V1 格式: "web:whatsapp:user123:chat456:0"
// V2 格式: "web|whatsapp|user123|chat456|0"

private migrateProfileKeys(store: IDBObjectStore, tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const record = cursor.value;
      const desiredKey = contactKeyToString(record.key);

      if (record.keyStr !== desiredKey) {
        // 需要迁移
        const updated = { ...record, keyStr: desiredKey };

        // 检查目标 key 是否已存在
        const existingRequest = store.get(desiredKey);
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result;
          const merged = existing
            ? mergeProfiles(existing, updated, desiredKey)
            : updated;

          // 删除旧记录，写入新记录
          cursor.delete();
          store.put(merged);
          cursor.continue();
        };
      } else {
        cursor.continue();
      }
    };
  });
}
```

### 数据合并策略

迁移时遇到重复数据的合并规则：

**画像合并** (`mergeProfiles`)：
- `displayName`: 优先使用有意义的名称（非 "Unknown"）
- `interests`: 合并去重
- `notes`: 按行合并去重，限制最大长度
- `createdAt`: 取较早时间
- `updatedAt`: 取较晚时间

**风格偏好合并** (`mergeStylePreferences`)：
- `styleHistory`: 合并计数，取较晚的 `lastUsed`
- `defaultStyle`: 重新计算（使用次数 ≥3 的最高频风格）

## 导出导入接口

### 导出快照

```typescript
const snapshot = await store.exportSnapshot();

// 快照结构
interface IndexedDBSnapshotV1 {
  schemaVersion: 1;
  exportedAt: number;
  profiles: ContactProfile[];
  stylePreferences: StylePreference[];
  thoughtPreferences?: ThoughtPreference[];
  contactMemories: ContactMemorySummary[];
}
```

**注意**：快照不包含原始消息内容，仅包含派生数据。

### 导入快照

```typescript
const result = await store.importSnapshot(snapshot);

console.log(result);
// {
//   imported: { profiles: 10, stylePreferences: 8, ... },
//   skipped: { profiles: 2, stylePreferences: 0, ... }
// }
```

**导入行为**：
- 有效记录：upsert（存在则更新，不存在则插入）
- 无效记录：跳过并计入 `skipped`

### 使用示例

```typescript
// 备份数据
async function backupData() {
  const store = new IndexedDBStore();
  await store.init();

  const snapshot = await store.exportSnapshot();
  const json = JSON.stringify(snapshot);

  // 下载为文件
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  // ...
}

// 恢复数据
async function restoreData(file: File) {
  const json = await file.text();
  const snapshot = JSON.parse(json) as IndexedDBSnapshotV1;

  const store = new IndexedDBStore();
  await store.init();

  const result = await store.importSnapshot(snapshot);
  console.log(`导入完成: ${result.imported.profiles} 个画像`);
}
```

---

**相关文档**: [架构设计](./ARCHITECTURE.md) | [API 参考](./API.md)
