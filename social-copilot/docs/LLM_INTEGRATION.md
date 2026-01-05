# LLM 提供商集成指南

本文档介绍 Social Copilot 的 LLM 管理架构及如何集成新的 LLM 提供商。

## 目录

- [架构概述](#架构概述)
- [提供商接口](#提供商接口)
- [LLM Manager](#llm-manager)
- [添加新提供商](#添加新提供商)
- [提示词钩子系统](#提示词钩子系统)
- [缓存策略](#缓存策略)
- [错误处理](#错误处理)

## 架构概述

```
┌─────────────────────────────────────────────────────┐
│                   LLMManager                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  LRU Cache  │  │ Dedup Map   │  │  Fallback   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────┤
│                   LLMProvider                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │DeepSeek │ │ OpenAI  │ │ Claude  │ │ Builtin │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────┘
```

**核心文件**:
```
packages/core/src/llm/
├── llm-manager.ts      # LLM 管理器（主入口）
├── provider.ts         # DeepSeek 提供商
├── openai.ts           # OpenAI 提供商
├── claude.ts           # Claude 提供商
├── builtin.ts          # 内置提供商
├── prompt-hooks.ts     # 提示词钩子系统
└── reply-validation.ts # 回复验证与解析
```

## 提供商接口

所有 LLM 提供商必须实现 `LLMProvider` 接口：

```typescript
// packages/core/src/types/llm.ts

export interface LLMProvider {
  /** 提供商名称 */
  readonly name: string;

  /** 生成回复 */
  generateReply(input: LLMInput): Promise<LLMOutput>;
}

export interface LLMInput {
  messages: ConversationMessage[];
  contactProfile?: ContactProfile;
  styleHint?: ReplyStyle;
  thoughtHint?: string;
  memorySummary?: string;
}

export interface LLMOutput {
  replies: ReplyOption[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

## LLM Manager

`LLMManager` 是 LLM 调用的统一入口，提供以下功能：

### 配置结构

```typescript
// packages/core/src/llm/llm-manager.ts:11-33

export interface LLMManagerConfig {
  primary: {
    provider: 'deepseek' | 'openai' | 'claude' | 'builtin';
    apiKey: string;
    model?: string;
    baseUrl?: string;
    allowInsecureHttp?: boolean;
    allowPrivateHosts?: boolean;
  };
  fallback?: {
    provider: ProviderType;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
  cache?: {
    enabled?: boolean;
    size?: number;    // 默认 100
    ttl?: number;     // 默认 300000ms (5分钟)
  };
}
```

### 基本用法

```typescript
import { LLMManager } from '@social-copilot/core';

const manager = new LLMManager({
  primary: {
    provider: 'deepseek',
    apiKey: 'sk-xxx',
    model: 'deepseek-chat',
  },
  fallback: {
    provider: 'openai',
    apiKey: 'sk-yyy',
  },
});

const result = await manager.generateReply({
  messages: conversationHistory,
  contactProfile: profile,
  styleHint: 'casual',
});
```

### 事件回调

```typescript
const manager = new LLMManager(config, {
  onFallback: (from, to, error) => {
    console.log(`切换: ${from} -> ${to}, 原因: ${error.message}`);
  },
  onRecovery: (provider) => {
    console.log(`主提供商恢复: ${provider}`);
  },
  onAllFailed: (errors) => {
    console.error('所有提供商失败:', errors);
  },
});
```
