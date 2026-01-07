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

## 添加新提供商

### 步骤 1: 创建提供商类

```typescript
// packages/core/src/llm/my-provider.ts

import type { LLMProvider, LLMInput, LLMOutput } from '../types';

export class MyProvider implements LLMProvider {
  readonly name = 'my-provider';

  constructor(private config: { apiKey: string; model?: string }) {}

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const response = await fetch('https://api.example.com/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: input.messages }),
    });

    const data = await response.json();
    return { replies: this.parseReplies(data) };
  }
}
```

### 步骤 2: 实现完整的提供商

以 NVIDIA Provider 为参考，完整实现需要包含：

```typescript
// packages/core/src/llm/nvidia.ts

import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';
import { parseReplyContent, ReplyParseError } from './reply-validation';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { PromptHookRegistry } from './prompt-hooks';
import { applySystemPromptHooks, applyUserPromptHooks } from './prompt-hooks';
import { normalizeBaseUrl } from './normalize-base-url';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

export interface NvidiaProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  allowInsecureHttp?: boolean;
  allowPrivateHosts?: boolean;
  registry?: PromptHookRegistry;
}

export class NvidiaProvider implements LLMProvider {
  readonly name = 'nvidia';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private registry?: PromptHookRegistry;

  constructor(config: NvidiaProviderConfig) {
    // 1. 验证 API Key
    if (!NvidiaProvider.validateApiKey(config.apiKey)) {
      throw new Error('Invalid NVIDIA apiKey');
    }
    this.apiKey = config.apiKey.trim();

    // 2. 规范化 Base URL
    this.baseUrl = normalizeBaseUrl(
      config.baseUrl || 'https://integrate.api.nvidia.com',
      {
        allowInsecureHttp: config.allowInsecureHttp,
        allowPrivateHosts: config.allowPrivateHosts,
      }
    );

    // 3. 设置默认模型
    this.model = config.model || 'z-ai/glm4.7';
    this.registry = config.registry;
  }

  // API Key 验证（NVIDIA 格式: nvapi-xxx）
  static validateApiKey(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') return false;
    const trimmed = apiKey.trim();
    return trimmed.startsWith('nvapi-') && !/\s/.test(trimmed);
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const task = input.task ?? 'reply';
    const startTime = Date.now();

    // 4. 构建提示词
    const systemPrompt = buildSystemPrompt(task, input);
    const userPrompt = buildUserPrompt(task, input);

    // 5. 应用提示词钩子
    const finalSystemPrompt = this.registry
      ? this.registry.applySystemHooks(systemPrompt, input)
      : applySystemPromptHooks(systemPrompt, input);
    const finalUserPrompt = this.registry
      ? this.registry.applyUserHooks(userPrompt, input)
      : applyUserPromptHooks(userPrompt, input);

    // 6. 发送请求
    const response = await fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: finalUserPrompt },
          ],
          temperature: input.temperature ?? 0.8,
          max_tokens: Math.min(input.maxLength ?? 1000, 2000),
        }),
        timeoutMs: 20_000,
        retry: { retries: 2 },
      }
    );

    // 7. 错误处理
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`NVIDIA API error: ${response.status}`);
    }

    // 8. 解析响应
    const data = await response.json();
    const content = this.extractContent(data);
    const candidates = parseReplyContent(content, input.styles, task);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  private extractContent(data: unknown): string {
    // OpenAI 兼容格式: data.choices[0].message.content
    const choices = (data as any).choices;
    return choices?.[0]?.message?.content ?? '';
  }
}
```

### 步骤 3: 注册到 LLMManager

在 `llm-manager.ts` 中添加新提供商：

```typescript
// packages/core/src/llm/llm-manager.ts

import { NvidiaProvider } from './nvidia';

// 1. 扩展 ProviderType
export type ProviderType = 'deepseek' | 'openai' | 'claude' | 'builtin' | 'nvidia';

// 2. 在 createProvider 方法中添加 case
private createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'deepseek':
      return new DeepSeekProvider({ ... });
    case 'openai':
      return new OpenAIProvider({ ... });
    case 'claude':
      return new ClaudeProvider({ ... });
    case 'nvidia':
      return new NvidiaProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        allowInsecureHttp: config.allowInsecureHttp,
        allowPrivateHosts: config.allowPrivateHosts,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### 步骤 4: 导出新提供商

```typescript
// packages/core/src/llm/index.ts
export { NvidiaProvider } from './nvidia';
export type { NvidiaProviderConfig } from './nvidia';
```

### 步骤 5: 编写单元测试

```typescript
// packages/core/src/llm/__tests__/nvidia.test.ts

import { describe, it, expect, vi } from 'vitest';
import { NvidiaProvider } from '../nvidia';

describe('NvidiaProvider', () => {
  describe('validateApiKey', () => {
    it('should accept valid nvapi- keys', () => {
      expect(NvidiaProvider.validateApiKey('nvapi-abc123')).toBe(true);
    });

    it('should reject invalid keys', () => {
      expect(NvidiaProvider.validateApiKey('')).toBe(false);
      expect(NvidiaProvider.validateApiKey('sk-xxx')).toBe(false);
    });
  });

  describe('generateReply', () => {
    it('should call NVIDIA API with correct format', async () => {
      // Mock fetch and test API call
    });
  });
});
```

## 提示词钩子系统

钩子系统允许在提示词构建过程中注入自定义逻辑：

```typescript
import { PromptHookRegistry } from '@social-copilot/core';

const registry = new PromptHookRegistry();

registry.register('beforeBuild', (context) => {
  // 在构建提示词前修改上下文
  return { ...context, customField: 'value' };
});

registry.register('afterBuild', (prompt) => {
  // 在构建后修改提示词
  return prompt + '\n请保持简洁。';
});
```

## 缓存策略

LLMManager 内置 LRU 缓存，避免重复请求：

- **容量**: 默认 100 条
- **TTL**: 默认 5 分钟
- **去重**: 并发相同请求自动合并

```typescript
// 获取缓存统计
const stats = manager.getCacheStats();
console.log(`命中率: ${(stats.hitRate * 100).toFixed(1)}%`);

// 清除缓存
manager.clearCache();
```

## 错误处理

### 自动重试

网络错误自动重试（最多 2 次），指数退避：

- 第 1 次重试: 500ms
- 第 2 次重试: 1000ms

### 回退机制

主提供商失败后自动切换到备用提供商，15 秒冷却期后尝试恢复。

### 解析错误重试

`ReplyParseError` 时自动追加 JSON 格式提示重试一次。

---

**相关文档**:
- [架构设计](./ARCHITECTURE.md)
- [思路系统](./THOUGHT_SYSTEM.md)
