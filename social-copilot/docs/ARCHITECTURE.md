# Social Copilot 架构设计

## 概述

Social Copilot 采用 monorepo 架构，使用 pnpm workspace 管理多个包。核心设计原则：

- **关注点分离**：核心逻辑与平台适配分离
- **可扩展性**：易于添加新平台和新模型
- **隐私优先**：数据本地存储，最小化网络传输
- **容错设计**：LLM 调用支持自动故障转移

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser Extension                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Popup     │  │  Content    │  │    Background           │  │
│  │   (设置)    │  │  Scripts    │  │    Service Worker       │  │
│  └─────────────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│                          │                      │                │
│  ┌───────────────────────┴──────────────────────┴─────────────┐  │
│  │                    Platform Adapters                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │  │
│  │  │ Telegram │  │ WhatsApp │  │  Slack   │  │  (更多)  │    │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @social-copilot/core                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    Types    │  │   Memory    │  │      LLM Manager        │  │
│  │   类型定义   │  │   存储层    │  │   模型管理与故障转移     │  │
│  └─────────────┘  └─────────────┘  └───────────┬─────────────┘  │
│                                                 │                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┴─────────────┐  │
│  │   Profile   │  │ Preference  │  │   Thought    │  │      LLM Providers      │  │
│  │   画像管理   │  │  偏好管理   │  │  思路分析     │  │  DeepSeek/OpenAI/Claude │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 模块详解

### @social-copilot/core

核心包，包含所有跨平台共享的逻辑。

#### Types 模块

定义所有核心类型：

```typescript
// 联系人标识
interface ContactKey {
  platform: 'web' | 'windows' | 'mac' | 'android' | 'ios';
  app: 'telegram' | 'whatsapp' | 'slack' | ...;
  conversationId: string;
  peerId: string;
  isGroup: boolean;
}

// 消息
interface Message {
  id: string;
  contactKey: ContactKey;
  direction: 'incoming' | 'outgoing';
  text: string;
  timestamp: number;
}

// 回复风格
type ReplyStyle = 'humorous' | 'caring' | 'rational' | 'casual' | 'formal';
```

#### Memory 模块

数据持久化层，使用 IndexedDB 存储：

- **消息存储**：按联系人存储历史消息
- **画像存储**：存储联系人画像信息
- **偏好存储**：存储风格偏好数据

```typescript
interface MemoryStore {
  saveMessage(message: Message): Promise<void>;
  getRecentMessages(contactKey: ContactKey, limit: number): Promise<Message[]>;
  getProfile(contactKey: ContactKey): Promise<ContactProfile | null>;
  saveProfile(profile: ContactProfile): Promise<void>;
}
```

#### LLM 模块

LLM 接入与管理：

- **Provider 接口**：统一的 LLM 调用接口
- **多模型支持**：DeepSeek、OpenAI、Claude
- **LLMManager**：管理主备模型，自动故障转移
- **思路提示**：接收 `thoughtHint`，让回复遵循选定的方向

```typescript
interface LLMProvider {
  readonly name: string;
  generateReply(input: LLMInput): Promise<LLMOutput>;
}

class LLMManager {
  // 自动故障转移
  async generateReply(input: LLMInput): Promise<LLMOutput>;
  // 获取当前活跃的 Provider
  getActiveProvider(): string;
}
```

#### Preference 模块

风格偏好学习：

- 记录用户对每个联系人的风格选择
- 达到阈值（3次）自动设为默认风格
- 按使用频率排序推荐风格

#### Thought 模块

对回复方向进行轻量分析与提示：

- **ThoughtAnalyzer**：基于当前消息的情绪/意图关键词，推荐共情、解决方案、幽默或中性方向。
- **思路卡片**：预设的 `THOUGHT_CARDS` 映射，包含 icon、标签与 prompt 提示片段。
- **ThoughtAwarePromptBuilder**：将选中的思路方向与提示片段注入到 LLM 输入，确保回复与用户意图一致。

### Browser Extension

Chrome 扩展实现。

#### Platform Adapters

平台适配器，每个聊天平台一个实现：

```typescript
interface PlatformAdapter {
  readonly platform: string;
  isMatch(): boolean;                    // 检测当前页面
  extractContactKey(): ContactKey;       // 提取联系人信息
  extractMessages(limit: number): Message[];  // 提取消息
  getInputElement(): HTMLElement | null; // 获取输入框
  fillInput(text: string): boolean;      // 填充回复
  onNewMessage(callback): () => void;    // 监听新消息
}
```

#### Background Service Worker

后台服务：

- 处理 Content Script 的消息
- 调用 LLM 生成回复
- 管理存储和配置

#### Content Scripts

注入到目标网站的脚本：

- 初始化平台适配器
- 监听新消息事件
- 渲染悬浮面板 UI
- 处理用户交互

## 数据流

### 回复生成流程

```
1. 用户收到新消息
   │
   ▼
2. Content Script 检测到消息
   │
   ▼
3. Platform Adapter 提取消息内容和联系人信息
   │
   ▼
3.5 ThoughtAnalyzer 分析当前消息 → 推荐思路卡片给 UI
   │
   ▼
4. 发送消息到 Background Service Worker
   │
   ▼
5. Background 从 IndexedDB 获取：
   - 最近 10 条历史消息
   - 联系人画像
   - 风格偏好
   - 选中的思路提示（thoughtHint）
   │
   ▼
6. LLMManager 调用 AI 模型生成候选回复（附带思路提示）
   │
   ▼
7. 返回候选回复到 Content Script
   │
   ▼
8. UI 渲染悬浮面板显示候选
   │
   ▼
9. 用户点击候选 → 填充到输入框
   │
   ▼
10. 记录风格选择，更新偏好
```

### 画像更新流程

```
1. 消息累计达到阈值（默认 20 条）
   │
   ▼
2. 触发画像提取任务
   │
   ▼
3. LLM 分析历史消息，提取：
   - 基本信息（年龄、职业、位置）
   - 兴趣爱好
   - 沟通风格
   - 关系类型
   │
   ▼
4. 对比现有画像，有增量则更新
```

### 思路分析流程

```
1. Content Script 捕获当前消息
   │
   ▼
2. 发送上下文给 ThoughtAnalyzer
   │
   ▼
3. 推荐思路顺序 + 卡片（含 promptHint）
   │
   ▼
4. UI 展示思路卡片，用户可选择方向
   │
   ▼
5. 选中的思路通过 LLM 输入的 thoughtHint 生效
```

## 存储设计

### IndexedDB 结构

```
Database: social-copilot
├── messages          # 消息存储
│   ├── key: contactKeyStr + messageId
│   └── indexes: contactKeyStr, timestamp
│
├── profiles          # 联系人画像
│   ├── key: contactKeyStr
│   └── indexes: updatedAt
│
└── stylePreferences  # 风格偏好
    ├── key: contactKeyStr
    └── indexes: updatedAt
```

### Chrome Storage

```
chrome.storage.local
├── settings          # 用户设置
│   ├── primaryProvider
│   ├── primaryApiKey
│   ├── fallbackProvider
│   ├── fallbackApiKey
│   └── defaultStyles
│
└── panelPosition     # 面板位置记忆
```

## 扩展指南

### 添加新平台适配器

1. 在 `adapters/` 创建新文件（如 `discord.ts`）
2. 实现 `PlatformAdapter` 接口
3. 在 `adapters/index.ts` 注册
4. 创建对应的 content script
5. 更新 `manifest.json` 和 `vite.config.ts`

### 添加新 LLM Provider

1. 在 `core/src/llm/` 创建新文件
2. 实现 `LLMProvider` 接口
3. 在 `llm-manager.ts` 的 `createProvider` 中注册
4. 更新 `ProviderType` 类型

## 安全考虑

- API Key 仅存储在本地 `chrome.storage.local`
- 消息数据存储在浏览器 IndexedDB，不上传
- LLM 调用仅发送必要的上下文（最近 10 条消息）
- 不收集用户行为数据
