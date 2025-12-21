# 贡献指南

感谢你对 Social Copilot 的关注！本指南将帮助你快速上手项目开发。

## 目录

- [开发环境设置](#开发环境设置)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [测试流程](#测试流程)
- [提交 Pull Request](#提交-pull-request)
- [提交消息规范](#提交消息规范)
- [常见问题](#常见问题)
- [获取帮助](#获取帮助)

---

## 开发环境设置

### 系统要求

- **Node.js**: ≥18.0.0
- **pnpm**: ≥8.0.0
- **浏览器**: Chrome 或 Edge（用于加载扩展）
- **操作系统**: macOS、Linux 或 Windows

### 安装步骤

1. **Fork 并克隆仓库**

```bash
# Fork 仓库到你的 GitHub 账号
# 然后克隆到本地
git clone https://github.com/YOUR_USERNAME/social-copilot.git
cd social-copilot
```

2. **安装依赖**

```bash
# 使用 pnpm 安装所有依赖
pnpm install
```

3. **构建项目**

```bash
# 构建所有包
pnpm build

# 或仅构建扩展
pnpm build:extension
```

4. **运行测试**

```bash
# 运行所有测试
pnpm test

# 运行类型检查
pnpm typecheck

# 运行 lint 检查
pnpm lint
```

5. **加载扩展到浏览器**

- 打开 Chrome，访问 `chrome://extensions/`
- 开启右上角「开发者模式」
- 点击「加载已解压的扩展程序」
- 选择 `packages/browser-extension/dist` 目录

详细的开发环境配置请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)。

---

## 项目结构

```
social-copilot/
├── packages/
│   ├── core/                    # 核心 SDK（跨平台共享）
│   │   ├── src/
│   │   │   ├── types/           # 类型定义
│   │   │   ├── memory/          # 存储层（IndexedDB）
│   │   │   ├── llm/             # LLM 接入与管理
│   │   │   ├── profile/         # 画像更新
│   │   │   ├── preference/      # 风格偏好管理
│   │   │   ├── thought/         # 思路分析与提示构建
│   │   │   └── utils/           # 工具函数
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── browser-extension/       # Chrome 扩展
│   │   ├── src/
│   │   │   ├── adapters/        # 平台适配器（Telegram、WhatsApp、Slack）
│   │   │   ├── background/      # Service Worker（后台逻辑）
│   │   │   ├── content-scripts/ # 注入脚本
│   │   │   ├── popup/           # 设置页面
│   │   │   └── ui/              # 悬浮面板（含思路卡片）
│   │   ├── manifest.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mobile/                  # 移动端预览（Expo）
│       ├── app/
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                        # 文档
│   ├── DEVELOPMENT.md           # 开发指南
│   ├── ARCHITECTURE.md          # 架构设计
│   ├── API.md                   # API 文档
│   ├── CONTRIBUTING.md          # 贡献指南（本文档）
│   └── ...
│
├── .claude/specs/               # 开发计划和规范
│   └── project-improvement/
│       └── dev-plan.md
│
├── scripts/                     # 构建和发布脚本
│   ├── ci-local.mjs
│   ├── e2e-smoke.mjs
│   ├── validate-release.mjs
│   └── package-extension.mjs
│
├── .eslintrc.cjs                # ESLint 配置
├── tsconfig.base.json           # TypeScript 基础配置
├── pnpm-workspace.yaml          # pnpm 工作区配置
├── package.json                 # 根 package.json
├── CHANGELOG.md                 # 更新日志
└── README.md                    # 项目说明
```

### 核心模块说明

- **`packages/core`**: 核心逻辑，包含 LLM 管理、存储、画像、偏好、思路分析等功能，可跨平台复用
- **`packages/browser-extension`**: Chrome 扩展，包含平台适配器、后台逻辑、内容脚本、UI 组件
- **`packages/mobile`**: 移动端预览客户端（使用 Expo）

---

## 开发流程

### 1. 创建功能分支

```bash
# 从 main 分支创建新分支
git checkout -b feature/your-feature-name

# 分支命名规范：
# - feature/xxx  - 新功能
# - fix/xxx      - Bug 修复
# - refactor/xxx - 代码重构
# - test/xxx     - 测试相关
# - docs/xxx     - 文档更新
```

### 2. 编写代码

- 遵循 [代码规范](#代码规范)
- 为公共 API 添加 JSDoc 注释
- 保持函数单一职责，避免过度复杂
- 使用 TypeScript 严格模式

### 3. 编写测试

- 为新功能编写单元测试
- 确保测试覆盖率 ≥90%
- 使用 Vitest 作为测试框架
- 使用 fake-indexeddb 模拟 IndexedDB
- 使用 jsdom 模拟 DOM 环境
- 使用 fast-check 进行属性测试（边界情况）

```bash
# 运行测试
pnpm test

# 运行特定包的测试
pnpm --filter @social-copilot/core test

# 监听模式（开发时使用）
pnpm --filter @social-copilot/core test:watch

# 查看覆盖率
pnpm test --coverage
```

### 4. 运行检查

```bash
# 类型检查
pnpm typecheck

# Lint 检查
pnpm lint

# 本地 CI（推荐）
pnpm ci:local
```

### 5. 提交代码

```bash
# 添加文件
git add .

# 提交（遵循 Conventional Commits 规范）
git commit -m "feat(core): add LLM request deduplication"

# 推送到远程分支
git push origin feature/your-feature-name
```

### 6. 创建 Pull Request

- 在 GitHub 上创建 Pull Request
- 填写 PR 描述（问题描述、解决方案、测试计划）
- 等待 Code Review
- 根据反馈修改代码
- 所有 CI 检查通过后，等待合并

---

## 代码规范

### TypeScript

- **严格模式**: 启用 `strict: true`（已在 `tsconfig.base.json` 中配置）
- **避免 `any`**: 尽量使用具体类型或泛型
- **JSDoc 注释**: 为公共 API 添加 JSDoc 注释

```typescript
/**
 * 生成回复建议
 * @param context - 对话上下文
 * @param options - 生成选项
 * @returns 回复建议列表
 */
export async function generateReply(
  context: ConversationContext,
  options: GenerateOptions
): Promise<Reply[]> {
  // ...
}
```

### ESLint 规则

项目使用 ESLint 进行代码检查，配置文件为 `.eslintrc.cjs`：

- 基于 `eslint:recommended` 和 `@typescript-eslint/recommended`
- 禁止未使用的变量和参数（`noUnusedLocals`, `noUnusedParameters`）
- 禁止 switch 语句的 fallthrough（`noFallthroughCasesInSwitch`）
- 测试文件中允许使用 Vitest 全局变量（`describe`, `test`, `it`, `expect` 等）

运行 lint 检查：

```bash
pnpm lint
```

### 命名约定

- **文件名**: kebab-case（如 `llm-manager.ts`）
- **类名**: PascalCase（如 `LLMManager`）
- **函数/变量**: camelCase（如 `generateReply`）
- **常量**: UPPER_SNAKE_CASE（如 `DEFAULT_STYLE_THRESHOLD`）
- **接口**: PascalCase，不加 `I` 前缀（如 `LLMProvider`）
- **类型别名**: PascalCase（如 `ReplyStyle`）

### 文件组织

- **每个模块一个目录**: 相关功能放在同一目录下
- **导出通过 `index.ts` 统一管理**: 避免深层导入路径
- **测试文件与源文件同目录**: 命名为 `*.test.ts`

```
src/
├── llm/
│   ├── index.ts           # 导出所有公共 API
│   ├── llm-manager.ts     # LLM 管理器
│   ├── llm-manager.test.ts # 测试文件
│   ├── openai.ts          # OpenAI Provider
│   ├── openai.test.ts     # 测试文件
│   └── types.ts           # 类型定义
```

### 注释规范

- **JSDoc**: 为公共 API 添加 JSDoc 注释
- **行内注释**: 仅在逻辑复杂或不明显时添加
- **TODO 注释**: 使用 `// TODO: description` 标记待办事项

```typescript
// 好的注释：解释为什么这样做
// 使用 LRU 缓存避免重复请求，提升性能
const cache = new LRUCache<string, Reply[]>(100);

// 不好的注释：重复代码逻辑
// 创建一个新的 LRU 缓存
const cache = new LRUCache<string, Reply[]>(100);
```

---

## 测试流程

### 测试框架

- **Vitest**: 单元测试和集成测试
- **fake-indexeddb**: 模拟 IndexedDB
- **jsdom**: 模拟 DOM 环境
- **fast-check**: 属性测试（边界情况）

### Extension：`fillInput` 实现规范（Selection/Range）

浏览器扩展里，适配器的 `fillInput(text)` 需要在不同类型的输入组件上行为一致，并避免使用已废弃的 `document.execCommand`。

- **优先使用通用工具函数**：`packages/browser-extension/src/adapters/base.ts` 中的 `setEditableText` 与 `dispatchInputLikeEvent`
- **`input/textarea`**：直接赋值 `value`
- **`contenteditable`**：使用 Selection/Range API 完成「替换全部文本 + 光标定位到末尾」
  - `range.selectNodeContents(element)` + `range.deleteContents()` 清空内容
  - `range.insertNode(textNode)` 插入文本节点
  - `range.setStartAfter(textNode)` + `range.collapse(true)` 将光标移动到文本末尾
  - `selection.removeAllRanges()` + `selection.addRange(range)` 应用 selection
- **事件派发**：设置文本后必须派发 `input`（必要时再派发 `change`），以触发 React/Vue 等框架的状态更新
  - 事件应为 `bubbles: true`、`composed: true`（跨 shadow root 时可用）
  - 优先构造 `InputEvent('input', { inputType: 'insertText', data: text })`，不支持时回退到普通 `Event('input')`

建议在 `fillInput` 里遵循以下顺序：

1. `setEditableText(element, text)`（负责写入文本 + caret）
2. `dispatchInputLikeEvent(element, text)`（负责触发 UI 框架响应）

### 测试覆盖率要求

- **Core 包**: ≥90%
- **Extension 包**: ≥90%
- **整体**: ≥90%

### 测试类型

#### 1. 单元测试

测试单个函数或类的行为：

```typescript
import { describe, test, expect } from 'vitest';
import { extractJsonBlock } from './json';

describe('extractJsonBlock', () => {
  test('should extract JSON object from text', () => {
    const text = 'Some text {"key": "value"} more text';
    const result = extractJsonBlock(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('should return null if no JSON found', () => {
    const text = 'No JSON here';
    const result = extractJsonBlock(text);
    expect(result).toBeNull();
  });
});
```

#### 2. 集成测试

测试多个模块的协作：

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { LLMManager } from './llm-manager';
import { IndexedDBStore } from './indexeddb-store';

describe('LLMManager integration', () => {
  let manager: LLMManager;
  let store: IndexedDBStore;

  beforeEach(() => {
    store = new IndexedDBStore();
    manager = new LLMManager({ store });
  });

  test('should generate reply and save to store', async () => {
    const reply = await manager.generateReply(context);
    const saved = await store.getMessage(reply.id);
    expect(saved).toEqual(reply);
  });
});
```

#### 3. 属性测试

使用 fast-check 测试边界情况：

```typescript
import { describe, test } from 'vitest';
import * as fc from 'fast-check';
import { extractJsonBlock } from './json';

describe('extractJsonBlock property tests', () => {
  test('should handle arbitrary JSON objects', () => {
    fc.assert(
      fc.property(fc.object(), (obj) => {
        const text = JSON.stringify(obj);
        const result = extractJsonBlock(text);
        expect(result).toEqual(obj);
      })
    );
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm --filter @social-copilot/core test

# 监听模式
pnpm --filter @social-copilot/core test:watch

# 查看覆盖率
pnpm test --coverage
```

### DOM 测试（jsdom）约定

项目默认测试环境为 `node`，仅在需要 DOM API（`document`、`window`、Selection/Range 等）时启用 `jsdom`。

以 `packages/browser-extension` 为例：

- **默认环境**：`node`（适合纯逻辑、解析、数据处理等测试）
- **自动启用 jsdom**：`src/ui/**/*.{test,spec}.ts`（由 `packages/browser-extension/vitest.config.ts` 的 `environmentMatchGlobs` 配置决定）
- **为单个测试文件启用 jsdom**：当测试不在 `src/ui/` 下，但确实需要 DOM 时，使用文件级别声明

```ts
// @vitest-environment jsdom
```

建议：

- UI 组件相关测试尽量放在 `packages/browser-extension/src/ui/` 目录下，自动获得 jsdom 环境
- 适配器/内容脚本测试尽量保持在 `node` 环境；只有确实依赖 DOM 时才启用 jsdom，并尽量用最小 DOM 片段（`document.body.innerHTML = ...`）构造场景

---

## 提交 Pull Request

### PR 标题格式

使用 Conventional Commits 格式：

```
<type>(<scope>): <description>
```

示例：
- `feat(core): add LLM request deduplication`
- `fix(extension): handle API timeout error`
- `refactor(llm): extract common base class`
- `test(core): add unit tests for json utils`
- `docs: update API documentation`

### PR 描述模板

```markdown
## 问题描述

简要描述要解决的问题或实现的功能。

## 解决方案

说明你的实现方案和关键决策。

## 测试计划

- [ ] 添加了单元测试
- [ ] 添加了集成测试
- [ ] 测试覆盖率 ≥90%
- [ ] 手动测试通过

## 相关 Issue

Closes #123
```

### Code Review 流程

1. **提交 PR**: 创建 Pull Request 并填写描述
2. **CI 检查**: 等待 CI 自动运行（lint、typecheck、test、build）
3. **Code Review**: 至少 1 个 reviewer 审查代码
4. **修改反馈**: 根据 reviewer 的反馈修改代码
5. **批准合并**: 所有检查通过且至少 1 个 approve 后，可以合并

### CI 检查

PR 提交后，CI 会自动运行以下检查：

- **Lint**: `pnpm lint`
- **Type Check**: `pnpm typecheck`
- **Test**: `pnpm test`
- **Build**: `pnpm build:extension:release`

所有检查必须通过才能合并。

### 合并要求

- 所有 CI 检查通过
- 至少 1 个 reviewer approve
- 没有未解决的 review 评论
- 代码符合项目规范
- 测试覆盖率 ≥90%

---

## 提交消息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### 类型（type）

- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 代码重构（不改变功能）
- `test`: 测试相关
- `docs`: 文档更新
- `chore`: 构建/工具相关
- `style`: 代码格式（不影响功能）
- `perf`: 性能优化

### 范围（scope）

- `core`: 核心 SDK
- `extension`: 浏览器扩展
- `mobile`: 移动端
- `llm`: LLM 模块
- `memory`: 存储模块
- `profile`: 画像模块
- `adapter`: 平台适配器

### 示例

```bash
# 新功能
git commit -m "feat(core): add LLM request deduplication"

# Bug 修复
git commit -m "fix(extension): handle API timeout error"

# 重构
git commit -m "refactor(llm): extract OpenAI/Claude common base class"

# 测试
git commit -m "test(core): add unit tests for json utils"

# 文档
git commit -m "docs: update API documentation"

# 性能优化
git commit -m "perf(core): parallelize message save and profile read"
```

---

## 常见问题

### 如何调试扩展？

1. **加载扩展到 Chrome**

   - 打开 `chrome://extensions/`
   - 开启「开发者模式」
   - 加载 `packages/browser-extension/dist` 目录

2. **查看后台日志**

   - 在扩展管理页面，点击「Service Worker」查看后台日志
   - 或在扩展图标上右键 → 「检查弹出内容」

3. **查看内容脚本日志**

   - 在目标网站（如 Telegram Web）打开开发者工具
   - 查看 Console 中的日志

4. **启用诊断模式**

   - 在扩展设置中开启「诊断模式」
   - 查看详细的性能和错误日志

详细调试技巧请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)。

### 如何添加新的 LLM 提供商？

1. **创建 Provider 类**

   在 `packages/core/src/llm/` 目录下创建新文件（如 `gemini.ts`）：

   ```typescript
   import type { LLMProvider, LLMTask, LLMResponse } from './types';

   export class GeminiProvider implements LLMProvider {
     constructor(private config: GeminiConfig) {}

     async generateReply(task: LLMTask): Promise<LLMResponse> {
       // 实现 API 调用逻辑
     }
   }
   ```

2. **添加到 LLMManager**

   在 `packages/core/src/llm/llm-manager.ts` 中注册新 Provider：

   ```typescript
   import { GeminiProvider } from './gemini';

   // 在 createProvider 方法中添加
   case 'gemini':
     return new GeminiProvider(config);
   ```

3. **添加测试**

   创建 `gemini.test.ts` 并添加单元测试。

4. **更新文档**

   在 [API.md](./API.md) 中添加新 Provider 的文档。

详细实现指南请参考 [API.md](./API.md#llm-模块)。

### 如何添加新的平台适配器？

1. **创建适配器类**

   在 `packages/browser-extension/src/adapters/` 目录下创建新文件（如 `discord-adapter.ts`）：

   ```typescript
   import type { PlatformAdapter } from './types';

   export class DiscordAdapter implements PlatformAdapter {
     detectInputBox(): HTMLElement | null {
       // 检测输入框
     }

     extractMessages(): Message[] {
       // 提取消息
     }

     injectUI(container: HTMLElement): void {
       // 注入 UI
     }
   }
   ```

2. **注册适配器**

   在 `packages/browser-extension/src/content-scripts/index.ts` 中注册：

   ```typescript
   import { DiscordAdapter } from '../adapters/discord-adapter';

   // 在 detectPlatform 方法中添加
   if (hostname.includes('discord.com')) {
     return new DiscordAdapter();
   }
   ```

3. **添加测试**

   创建 `discord-adapter.test.ts` 并添加集成测试。

4. **更新 manifest.json**

   在 `packages/browser-extension/manifest.json` 中添加 Discord 域名权限。

详细实现指南请参考 [API.md](./API.md#platform-adapter-平台适配器)。

### 如何运行 E2E 测试？

```bash
# 构建扩展并运行 smoke 测试（Telegram、WhatsApp、Slack）
pnpm e2e:smoke

# 仅运行部分平台
SC_E2E_TARGETS=telegram,slack pnpm e2e:smoke

# 指定浏览器可执行文件路径（找不到 Chrome/Edge 时使用）
SC_E2E_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm e2e:smoke
```

注意：运行 E2E 测试前，需要在目标网站登录并进入任意聊天视图。

---

## 获取帮助

如有任何问题，欢迎：

- **提交 Issue**: 在 [GitHub Issues](https://github.com/tytsxai/social-copilot/issues) 中提问
- **查阅文档**: 参考 [docs/](.) 目录下的其他文档
- **参考代码**: 查看代码中的注释和测试用例

### 相关文档

- [DEVELOPMENT.md](./DEVELOPMENT.md) - 开发指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [API.md](./API.md) - API 文档
- [CONFIGURATION.md](./CONFIGURATION.md) - 配置说明
- [RUNBOOK.md](./RUNBOOK.md) - 运行手册

---

## 行为准则

- 尊重所有贡献者
- 保持友善和专业的沟通
- 接受建设性的批评
- 关注项目的最佳利益
- 遵守开源社区规范

---

感谢你的贡献！
