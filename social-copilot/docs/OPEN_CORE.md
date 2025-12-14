# Open-core 方案（推荐落地版）

目标：**开源版易用、可协作、可持续维护**；商业/私有增强不进入公共仓库，但能以可控方式接入，不破坏开源版构建。

## 1. 开源 / 闭源边界（本仓库约定）

### 开源（公共仓库）

- `packages/core`：核心 SDK（类型、存储、画像、偏好、思路、LLM 接入）
- `packages/browser-extension`：浏览器扩展（适配器、UI、配置）
- `packages/mobile`：移动端预览（可选）
- `docs/`：开发与架构文档（不包含敏感密钥/内部数据）

### 闭源（私有仓库或本地私有目录）

建议保持私有的内容（按“复刻成本/商业价值/维护成本”优先级）：

- 高价值 Prompt Pack（更强的系统提示、策略、模板、风格细节）
- 付费能力：订阅、授权、配额、灰度、A/B、反滥用
- 运营与增长逻辑、内部数据集/话术库、评测与评分体系
- （如需要）服务端编排：策略下发、模型路由、成本优化、风控

本地私有代码建议放在仓库根目录的 `private/`（已在 `.gitignore` 中默认忽略）。

## 2. 私有增强的接入方式（Prompt Hook）

`@social-copilot/core` 已提供 Prompt Hook，可对不同 Provider 的系统/用户提示词做“可插拔增强”。

### API

- `registerPromptHook(hook)`：注册 Hook（按注册顺序执行）
- `applySystemPromptHooks(prompt, input)`：内部调用（对系统提示词做变换）
- `applyUserPromptHooks(prompt, input)`：内部调用（对用户提示词做变换）
- `clearPromptHooks()`：测试/重置用

### Hook 形态

```ts
import { registerPromptHook } from '@social-copilot/core';

registerPromptHook({
  name: 'pro-prompt-pack',
  transformSystemPrompt: (prompt, input) => {
    if ((input.task ?? 'reply') !== 'reply') return prompt;
    return `${prompt}\n\n【额外约束】回复更口语、更贴近双方关系，不要复述对方原话。`;
  },
  transformUserPrompt: (prompt) => prompt,
});
```

### 推荐做法

- 仅在“商业版/内部版”入口处注册 Hook（不要在开源核心里硬编码私有策略）
- 把高价值内容拆成多个 Hook（便于灰度与排查）
- Hook 保持“纯函数”（不读写全局状态；必要时通过配置注入）

## 3. 发布节奏建议

- 公共仓库：走社区节奏（稳定、可审计、文档完整、CI 完整）
- 私有增强：走商业节奏（快速迭代、可灰度、可回滚）
- 通过 Hook/接口层保证两条线解耦，减少互相阻塞

