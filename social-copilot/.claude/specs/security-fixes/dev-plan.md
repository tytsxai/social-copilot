# Security & Quality Fixes Development Plan

## Overview
修复 20 个 codeagent 审查发现的全部问题（P0/P1/P2）

## Task Breakdown

### P0 安全问题（并行组 A）

#### TASK-001: XSS 修复
- **描述**: style label 注入点 HTML 转义
- **文件范围**:
  - `packages/browser-extension/src/ui/copilot-ui.ts`
  - `packages/browser-extension/src/popup/preferences.ts`
- **修复方案**:
  1. `copilot-ui.ts:190` - `getStyleLabel()` 返回值用 `escapeHtml()` 包裹
  2. `preferences.ts:23` - `renderStyleStats()` 中 label 做 escape
- **测试**: `pnpm --filter @social-copilot/browser-extension test`
- **依赖**: 无

#### TASK-002: 原型污染修复
- **描述**: LLM JSON 安全合并，防止 `__proto__` 污染
- **文件范围**:
  - `packages/core/src/profile/updater.ts`
  - `packages/core/src/utils/safe-merge.ts` (新增)
- **修复方案**:
  1. 新增 `safeAssignPlain()` 函数，过滤危险键
  2. `updater.ts:95,103` 使用安全合并替代直接 spread
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: 无

#### TASK-003: 正则兼容性修复
- **描述**: 移除 lookbehind 断言，兼容旧浏览器
- **文件范围**:
  - `packages/core/src/privacy/sanitize.ts`
  - `packages/core/src/privacy/sanitize.test.ts`
- **修复方案**:
  1. 将 `(?<!\w)` 改为 `(^|[^\w])` 捕获组
  2. 替换时保留前导字符 `$1[PHONE]`
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: 无

### P1 错误处理（并行组 B）

#### TASK-004: Hook 异常降级
- **描述**: hook transform 异常不中断流程
- **文件范围**:
  - `packages/core/src/llm/prompt-hooks.ts`
  - `packages/core/src/llm/prompt-hooks.test.ts`
- **修复方案**:
  1. `applySystemPromptHooks`/`applyUserPromptHooks` 内 try/catch
  2. 捕获后 `console.warn` 并继续下一个 hook
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: 无

#### TASK-005: DOM 异常捕获
- **描述**: `queryFirst()` 捕获非法 selector 的 DOMException
- **文件范围**:
  - `packages/browser-extension/src/adapters/base.ts`
  - `packages/browser-extension/src/adapters/adapters.test.ts`
- **修复方案**:
  1. `querySelector` 调用包 try/catch
  2. 异常时跳过该 selector 继续尝试
- **测试**: `pnpm --filter @social-copilot/browser-extension test`
- **依赖**: 无

#### TASK-006: 原子更新
- **描述**: IDB style preference 单事务原子更新
- **文件范围**:
  - `packages/core/src/memory/indexeddb-store.ts`
  - `packages/core/src/preference/manager.ts`
  - `packages/core/src/preference/manager.test.ts`
- **修复方案**:
  1. `IndexedDBStore` 新增 `updateStylePreference(key, updaterFn)`
  2. `manager.recordStyleSelection()` 改用原子 API
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: 无

### P2 架构优化（并行组 C）

#### TASK-007: Hook 实例化
- **描述**: prompt hooks 从全局改为实例 registry
- **文件范围**:
  - `packages/core/src/llm/prompt-hooks.ts`
  - `packages/core/src/llm/llm-manager.ts`
- **修复方案**:
  1. 新增 `PromptHookRegistry` 类
  2. 保留默认导出兼容现有调用
  3. LLMManager 使用实例 registry
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: TASK-004

#### TASK-008: Analyzer 可配置
- **描述**: ThoughtAnalyzer 关键词/权重可配置
- **文件范围**:
  - `packages/core/src/thought/analyzer.ts`
  - `packages/core/src/thought/analyzer.test.ts`
- **修复方案**:
  1. 构造函数接受 `ThoughtAnalyzerConfig`
  2. 默认配置保持现有行为
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: 无

#### TASK-009: Prompt 构建抽取
- **描述**: 提取公共 prompt 构建函数
- **文件范围**:
  - `packages/core/src/llm/prompts.ts` (新增)
  - `packages/core/src/llm/provider.ts`
  - `packages/core/src/llm/claude.ts`
  - `packages/core/src/llm/openai.ts`
- **修复方案**:
  1. 新增 `prompts.ts` 含 `buildSystemPrompt`/`buildUserPrompt`
  2. 三个 provider 调用公共函数
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: TASK-007

#### TASK-010: 输入长度治理
- **描述**: 统一输入预算，防止 token 膨胀
- **文件范围**:
  - `packages/core/src/llm/input-budgets.ts` (新增)
  - `packages/core/src/llm/prompts.ts`
  - `packages/core/src/profile/updater.ts`
- **修复方案**:
  1. 定义 `InputBudgets` 配置
  2. `normalizeAndClampLLMInput()` 裁剪各字段
  3. provider 入口调用
- **测试**: `pnpm --filter @social-copilot/core test`
- **依赖**: TASK-009

## Execution Strategy

### 并行组 A（无依赖，可完全并行）
- TASK-001, TASK-002, TASK-003, TASK-005, TASK-008

### 并行组 B（弱依赖）
- TASK-004, TASK-006

### 串行链（强依赖）
- TASK-007 → TASK-009 → TASK-010

## Test Commands
```bash
# 单包测试
pnpm --filter @social-copilot/core test
pnpm --filter @social-copilot/browser-extension test

# 全量测试
pnpm test
```

## UI Determination
- **needs_ui**: false
- **evidence**: 本次修复仅涉及安全转义和逻辑修复，不改变 UI 交互或样式
