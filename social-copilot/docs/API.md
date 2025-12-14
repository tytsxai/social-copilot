# Social Copilot API 文档

本文档描述 `@social-copilot/core` 包的核心 API。

## 目录

- [Types 类型定义](#types-类型定义)
- [Memory 存储模块](#memory-存储模块)
- [LLM 模块](#llm-模块)
- [Preference 偏好模块](#preference-偏好模块)
- [Thought 思路模块](#thought-思路模块)
- [Platform Adapter 平台适配器](#platform-adapter-平台适配器)

---

## Types 类型定义

### ContactKey

联系人唯一标识。

```typescript
interface ContactKey {
  /** 平台类型 */
  platform: 'web' | 'windows' | 'mac' | 'android' | 'ios';
  /** 应用标识 */
  app: 'telegram' | 'whatsapp' | 'slack' | 'discord' | 'wechat' | 'qq' | 'other';
  /** 本端账号ID（可选） */
  accountId?: string;
  /** 会话ID */
  conversationId: string;
  /** 对方标识（用户ID或昵称） */
  peerId: string;
  /** 是否群聊 */
  isGroup: boolean;
}
```

### ContactProfile

联系人画像。

```typescript
interface ContactProfile {
  key: ContactKey;
  /** 显示名称 */
  displayName: string;
  /** 基本信息 */
  basicInfo?: {
    ageRange?: string;
    occupation?: string;
    location?: string;
  };
  /** 兴趣偏好 */
  interests: string[];
  /** 沟通偏好 */
  communicationStyle?: {
    prefersShortMessages?: boolean;
    usesEmoji?: boolean;
    formalityLevel?: 'casual' | 'neutral' | 'formal';
  };
  /** 关系类型 */
  relationshipType?: 'friend' | 'colleague' | 'family' | 'acquaintance' | 'romantic' | 'other';
  /** 备注 */
  notes?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}
```

### Message

消息结构。

```typescript
interface Message {
  /** 消息ID */
  id: string;
  /** 所属会话 */
  contactKey: ContactKey;
  /** 消息方向 */
  direction: 'incoming' | 'outgoing';
  /** 发送者名称 */
  senderName: string;
  /** 消息文本内容 */
  text: string;
  /** 时间戳 */
  timestamp: number;
  /** 原始数据（调试用） */
  raw?: unknown;
}
```

### ReplyStyle

回复风格类型。

```typescript
type ReplyStyle = 'humorous' | 'caring' | 'rational' | 'casual' | 'formal';
```

| 值 | 说明 |
|---|---|
| `humorous` | 幽默风趣 |
| `caring` | 关心体贴 |
| `rational` | 理性客观 |
| `casual` | 随意轻松 |
| `formal` | 正式礼貌 |

### ThoughtType

思路方向枚举与预设卡片，用于控制回复的语气/意图。

```typescript
type ThoughtType = 'empathy' | 'solution' | 'humor' | 'neutral';

interface ThoughtCard {
  type: ThoughtType;
  label: string;
  description: string;
  icon: string;
  promptHint: string; // 将注入到 thoughtHint 中
}

const THOUGHT_CARDS: Record<ThoughtType, ThoughtCard>;
```

| 值 | 说明 |
|---|---|
| `empathy` | 共情关怀，回应情绪/压力 |
| `solution` | 解决方案，给出建议或帮助 |
| `humor` | 幽默化解，活跃气氛 |
| `neutral` | 中性回应，平和自然 |

### LLMInput

LLM 调用输入。

```typescript
interface LLMInput {
  /** 对话上下文 */
  context: ConversationContext;
  /** 联系人画像 */
  profile?: ContactProfile;
  /** 记忆摘要 */
  memorySummary?: string;
  /** 期望的回复风格 */
  styles: ReplyStyle[];
  /** 语言偏好 */
  language: 'zh' | 'en' | 'auto';
  /** 最大回复长度 */
  maxLength?: number;
  /** 任务类型 */
  task?: 'reply' | 'profile_extraction';
  /** 可选的回复方向（用于思路卡片） */
  thoughtDirection?: ThoughtType;
  /** 注入到提示词的思路提示 */
  thoughtHint?: string;
}
```

### LLMOutput

LLM 调用输出。

```typescript
interface LLMOutput {
  /** 候选回复列表 */
  candidates: ReplyCandidate[];
  /** 模型名称 */
  model: string;
  /** 耗时(ms) */
  latency: number;
  /** 原始响应（调试用） */
  raw?: unknown;
}

interface ReplyCandidate {
  /** 回复文本 */
  text: string;
  /** 风格标签 */
  style: ReplyStyle;
  /** 置信度 0-1 */
  confidence?: number;
}
```

### 工具函数

```typescript
/**
 * 将 ContactKey 转换为字符串形式，用于存储索引
 */
function contactKeyToString(key: ContactKey): string;
```

---

## Memory 存储模块

### MemoryStore 接口

```typescript
interface MemoryStore {
  /** 保存消息 */
  saveMessage(message: Message): Promise<void>;
  
  /** 获取最近消息 */
  getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]>;
  
  /** 获取联系人画像 */
  getProfile(contactKey: ContactKey): Promise<ContactProfile | null>;
  
  /** 保存联系人画像 */
  saveProfile(profile: ContactProfile): Promise<void>;
  
  /** 更新联系人画像 */
  updateProfile(contactKey: ContactKey, updates: Partial<ContactProfile>): Promise<void>;
  
  /** 初始化存储 */
  init(): Promise<void>;
  
  /** 关闭存储 */
  close(): Promise<void>;
}
```

### IndexedDBStore

IndexedDB 实现的持久化存储。

```typescript
class IndexedDBStore implements MemoryStore {
  constructor();
  
  // 实现 MemoryStore 接口的所有方法
  
  /** 获取风格偏好 */
  getStylePreference(contactKey: ContactKey): Promise<StylePreference | null>;
  
  /** 保存风格偏好 */
  saveStylePreference(preference: StylePreference): Promise<void>;
  
  /** 删除风格偏好 */
  deleteStylePreference(contactKey: ContactKey): Promise<void>;
  
  /** 获取所有风格偏好 */
  getAllStylePreferences(): Promise<StylePreference[]>;
}
```

#### 使用示例

```typescript
import { IndexedDBStore } from '@social-copilot/core';

const store = new IndexedDBStore();
await store.init();

// 保存消息
await store.saveMessage({
  id: 'msg_123',
  contactKey: { /* ... */ },
  direction: 'incoming',
  senderName: 'Alice',
  text: 'Hello!',
  timestamp: Date.now(),
});

// 获取最近消息
const messages = await store.getRecentMessages(contactKey, 10);
```

---

## LLM 模块

### LLMProvider 接口

```typescript
interface LLMProvider {
  /** Provider 名称 */
  readonly name: string;
  
  /** 生成回复 */
  generateReply(input: LLMInput): Promise<LLMOutput>;
}
```

### DeepSeekProvider

DeepSeek API 实现。

```typescript
interface DeepSeekConfig {
  apiKey: string;
  model?: string;  // 默认: 'deepseek-v3.2'
  baseUrl?: string;
}

class DeepSeekProvider implements LLMProvider {
  constructor(config: DeepSeekConfig);
  readonly name: string;  // 'deepseek'
  generateReply(input: LLMInput): Promise<LLMOutput>;
}
```

### OpenAIProvider

OpenAI API 实现。

```typescript
interface OpenAIConfig {
  apiKey: string;
  model?: string;  // 默认: 'gpt-5.2-chat-latest'
  baseUrl?: string;
}

class OpenAIProvider implements LLMProvider {
  constructor(config: OpenAIConfig);
  readonly name: string;  // 'openai'
  generateReply(input: LLMInput): Promise<LLMOutput>;
}
```

### ClaudeProvider

Anthropic Claude API 实现。

```typescript
interface ClaudeConfig {
  apiKey: string;
  model?: string;  // 默认: 'claude-sonnet-4-5'
}

class ClaudeProvider implements LLMProvider {
  constructor(config: ClaudeConfig);
  readonly name: string;  // 'claude'
  generateReply(input: LLMInput): Promise<LLMOutput>;
}
```

### LLMManager

LLM 管理器，支持主备切换和自动故障转移。

```typescript
type ProviderType = 'deepseek' | 'openai' | 'claude';

interface LLMManagerConfig {
  primary: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
  };
  fallback?: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
  };
}

interface LLMManagerEvents {
  /** 切换到备用模型时触发 */
  onFallback?: (fromProvider: string, toProvider: string, error: Error) => void;
  /** 主模型恢复时触发 */
  onRecovery?: (provider: string) => void;
  /** 所有模型都失败时触发 */
  onAllFailed?: (errors: Error[]) => void;
}

class LLMManager {
  constructor(config: LLMManagerConfig, events?: LLMManagerEvents);
  
  /** 生成回复（自动故障转移） */
  generateReply(input: LLMInput): Promise<LLMOutput>;
  
  /** 更新配置 */
  updateConfig(config: LLMManagerConfig): void;
  
  /** 获取当前活跃的 Provider 名称 */
  getActiveProvider(): string;
  
  /** 是否配置了备用模型 */
  hasFallback(): boolean;
  
  /** 重置主模型状态，强制下次尝试主模型 */
  resetPrimaryState(): void;
}
```

#### 使用示例

```typescript
import { LLMManager } from '@social-copilot/core';

const manager = new LLMManager({
  primary: {
    provider: 'deepseek',
    apiKey: 'sk-xxx',
  },
  fallback: {
    provider: 'openai',
    apiKey: 'sk-yyy',
  },
}, {
  onFallback: (from, to, error) => {
    console.log(`Switched from ${from} to ${to}: ${error.message}`);
  },
});

const result = await manager.generateReply({
  context: { /* ... */ },
  styles: ['casual', 'humorous'],
  language: 'zh',
});
```

---

## Preference 偏好模块

### StylePreference

风格偏好数据结构。

```typescript
interface StyleHistoryEntry {
  style: ReplyStyle;
  count: number;
  lastUsed: number;
}

interface StylePreference {
  contactKeyStr: string;
  styleHistory: StyleHistoryEntry[];
  defaultStyle: ReplyStyle | null;
  updatedAt: number;
}
```

### StylePreferenceManager

风格偏好管理器。

```typescript
class StylePreferenceManager {
  constructor(store: IndexedDBStore);
  
  /**
   * 记录风格选择
   * 更新历史记录，达到阈值（3次）自动设为默认
   */
  recordStyleSelection(contactKey: ContactKey, style: ReplyStyle): Promise<void>;
  
  /** 获取联系人的风格偏好 */
  getPreference(contactKey: ContactKey): Promise<StylePreference | null>;
  
  /**
   * 获取推荐风格列表
   * 按使用频率排序，未使用的风格排在最后
   */
  getRecommendedStyles(contactKey: ContactKey): Promise<ReplyStyle[]>;
  
  /** 重置联系人的风格偏好 */
  resetPreference(contactKey: ContactKey): Promise<void>;
  
  /** 导出所有偏好数据 */
  exportPreferences(): Promise<StylePreference[]>;
}
```

#### 使用示例

```typescript
import { StylePreferenceManager, IndexedDBStore } from '@social-copilot/core';

const store = new IndexedDBStore();
await store.init();

const prefManager = new StylePreferenceManager(store);

// 记录用户选择了 casual 风格
await prefManager.recordStyleSelection(contactKey, 'casual');

// 获取推荐风格（按使用频率排序）
const styles = await prefManager.getRecommendedStyles(contactKey);
// => ['casual', 'humorous', 'caring', 'rational', 'formal']
```

---

## Thought 思路模块

### 预设卡片（THOUGHT_CARDS）

思路卡片是一个 `ThoughtType -> ThoughtCard` 的映射，包含标签、icon 以及注入提示词：

```typescript
interface ThoughtCard {
  type: ThoughtType;
  label: string;        // 展示标签
  description: string;  // 简要说明
  icon: string;         // 表情/图标
  promptHint: string;   // 加入提示词的说明
}
```

### ThoughtAnalyzer

基于当前消息快速推荐思路方向。

```typescript
interface ThoughtAnalysisResult {
  recommended: ThoughtType[];
  confidence: number;
  reason?: string;
}

const analyzer = new ThoughtAnalyzer();
const result = analyzer.analyze(context);   // 返回 ThoughtAnalysisResult
const cards = analyzer.getRecommendedCards(result); // 映射到可展示的卡片
```

- `analyze(context)`：根据语气关键词（负面/求助/轻松）返回排序后的 `recommended: ThoughtType[]`、`confidence` 与 `reason`。
- `getAllCards()`：返回所有预设卡片列表。
- `getRecommendedCards(result)`：按推荐顺序输出卡片，用于 UI 展示。

### ThoughtAwarePromptBuilder

辅助构建带思路提示的 `LLMInput`。

```typescript
const builder = new ThoughtAwarePromptBuilder();
const input = builder.buildInput(context, profile, styles, 'empathy');
// input.thoughtDirection === 'empathy'
// input.thoughtHint === THOUGHT_CARDS.empathy.promptHint
```

- `buildInput(...)`：在基础输入上注入 `thoughtDirection` / `thoughtHint`，可指定语言（默认 `zh`）。
- `getThoughtPromptSegment(thought)`：单独获取某个思路的提示片段。

---

## Platform Adapter 平台适配器

### PlatformAdapter 接口

```typescript
interface PlatformAdapter {
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
  
  /** 监听新消息，返回取消监听的函数 */
  onNewMessage(callback: (message: Message) => void): () => void;
}
```

### 适配器契约（必须满足）

为了保证 **画像 / 偏好 / 长期记忆 / 消息存储** 不串号、不丢失，所有适配器需要满足以下约束：

#### ContactKey 约束

- `conversationId` **必须稳定且唯一**（优先使用平台内部会话 ID，如 Telegram chatId / WhatsApp JID / Slack channelId），不要使用“联系人显示名/群名”作为主键。
- `accountId` 可选；当同一站点可能存在多账号/多 workspace 时建议填充（例如 Slack 的 teamId）。
- `peerId` 仅用于展示，可随页面标题变化，不应影响存储 key（当前存储 key 已不包含 `peerId`）。
- `isGroup` 需要尽量准确（用于决定是否做长期记忆等策略）。

#### Message 约束

- `id` 必须 **稳定且全局唯一**（至少在本扩展的 IndexedDB 中全局唯一）。如果平台原生 messageId 只在“单会话内唯一”，需要用 `contactKeyStr` 做命名空间前缀或做 hash。
- `text` 必须是纯文本（不要把 HTML 直接写进输入框；适配器填充时也应避免 HTML 注入）。
- `timestamp` 允许 best-effort，但必须能正确区分“同一会话内的先后顺序”（跨天/带日期时建议解析日期）。

#### 行为约束

- `extractMessages(limit)` 只能返回 **当前会话** 的消息，避免把其它会话或侧边栏的内容混入。
- `onNewMessage(callback)` 需要尽量避免重复回调同一条消息（常见做法：监听会话容器 + 使用稳定 messageId 去重）。

### 内置适配器

- `TelegramAdapter` - Telegram Web 适配器
- `WhatsAppAdapter` - WhatsApp Web 适配器
- `SlackAdapter` - Slack Web 适配器

### getAdapter()

获取当前页面匹配的适配器。

```typescript
function getAdapter(): PlatformAdapter | null;
```

#### 使用示例

```typescript
import { getAdapter } from '@social-copilot/browser-extension/adapters';

const adapter = getAdapter();
if (adapter) {
  console.log(`Detected platform: ${adapter.platform}`);
  
  const contactKey = adapter.extractContactKey();
  const messages = adapter.extractMessages(10);
  
  // 监听新消息
  const unsubscribe = adapter.onNewMessage((message) => {
    console.log('New message:', message.text);
  });
  
  // 填充回复
  adapter.fillInput('Hello!');
}
```

### 实现新适配器

```typescript
import type { PlatformAdapter, Message, ContactKey } from '@social-copilot/core';

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord';
  
  isMatch(): boolean {
    return window.location.hostname === 'discord.com';
  }
  
  extractContactKey(): ContactKey | null {
    // 从 DOM 或 URL 提取会话信息
  }
  
  extractMessages(limit: number): Message[] {
    // 从 DOM 提取消息列表
  }
  
  getInputElement(): HTMLElement | null {
    return document.querySelector('[data-slate-editor="true"]');
  }
  
  fillInput(text: string): boolean {
    // 填充文本到输入框
  }
  
  onNewMessage(callback: (message: Message) => void): () => void {
    // 使用 MutationObserver 监听 DOM 变化
  }
}
```
