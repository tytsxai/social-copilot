# AUDIT-025 - 架构健康度评估（Architecture Health Report）

> 自动化扫描：`node scripts/audit-025.mjs > /tmp/audit-025.json`
>
> 本报告结合静态依赖图（import 关系）+ 目录分层 + 重复片段启发式检测（非语义级别）给出结论与建议。

## 1) 项目结构概览

- Monorepo（pnpm workspace），核心包 `packages/core`，两端消费包 `packages/browser-extension`、`packages/mobile`。
- 依赖方向：`browser-extension` → `core`，`mobile` → `core`；`core` 不应反向依赖两端（当前从配置上看符合）。
- 扫描统计（源文件数）：`core=63`、`browser-extension=18`、`mobile=4`。

## 2) 模块耦合度（Coupling）

### 观察

- `core` 是域模型与能力中枢：类型（`types/`）、LLM（`llm/`）、记忆（`memory/`）、偏好（`preference/`）、画像（`profile/`）、隐私（`privacy/`）、思维卡（`thought/`）等并列子域。
- `browser-extension` 包含：适配器（`adapters/`）+ 注入/抓取（`content-scripts/`）+ 后台编排（`background/`）+ UI（`ui/`、`popup/`）。
- `mobile` 目前更薄：screens + coreClient 适配层（`adapters/`）+ env（配置读取）。

### 风险点（典型耦合来源）

- `browser-extension/src/background/*` 通常会成为“编排巨石”（高扇入/扇出）：既依赖 core，又依赖 adapters、UI 消息协议、chrome API。
- `core/src/index.ts` 往往是耦合汇聚点（barrel 导出），容易形成“隐式依赖扩散”：消费者一旦 `import {...} from '@social-copilot/core'`，边界会被弱化。

### 扫描到的耦合热点（Top fan-in/out）

- `packages/core/src/types/index.ts`：fan-in=30，fan-out=6（类型汇聚点，注意避免把业务实现也卷进来）。
- `packages/core/src/types/contact.ts`：fan-in=16（领域基础类型，合理，但要保持纯净）。
- `packages/browser-extension/src/adapters/base.ts`：fan-in=10（适配器基类/工具聚合，后续抽公共逻辑的最佳落点）。

## 3) 循环依赖（Circular Dependencies）

> 以 `scripts/audit-025.mjs` 的 SCC（强连通分量）为准；若存在会列在扫描结果中。

- 目标状态：`core` 内部无跨子域循环（例如 `memory` ↔ `profile` ↔ `preference`）。
- 若发现循环：优先用“依赖倒置 + 事件/接口 + DTO”拆解；避免用 barrel 导出硬解（会掩盖问题）。
- 当前扫描结果：`core / browser-extension / mobile` 均未发现循环依赖（SCC>1 为 0）。

## 4) 代码重复（Duplication）

### 观察

- 两端（extension/mobile）都存在“coreClient/LLM 配置读取/消息转换”这类胶水代码，天然容易复制粘贴。
- `browser-extension/src/adapters/*` 常出现平台相似逻辑（联系人/消息抽取与标准化），应考虑抽象出共享 adapter 基类/工具函数。

### 建议

- 将跨端共用的“输入标准化、消息 schema、序列化/反序列化、基础校验”尽可能下沉到 `core/src`（或新增 `packages/shared`），两端仅保留平台 API 接入与 DOM/Native 采集。
- 扫描到的重复片段（启发式）：`packages/browser-extension/src/adapters/slack.ts:206` 与 `packages/browser-extension/src/adapters/telegram.ts:222` 存在相同的 observer + retry 清理逻辑，建议抽到 `packages/browser-extension/src/adapters/base.ts` 或 `src/adapters/utils/*`。

## 5) 抽象层次（Abstraction Layers）

### 当前分层（建议对齐的理想形态）

- **core**：纯业务/领域能力（无 UI、无平台 API），以 `zod` schema 和纯函数/类为主。
- **platform adapters（extension/mobile）**：平台采集/适配（DOM/Chrome API/React Native API），输出统一的 core DTO。
- **orchestrator（background/mobile screens）**：会话编排、状态机、缓存、错误处理（尽量薄）。
- **UI**：只渲染与交互，不含解析/抽取逻辑。

### 典型反模式

- 在 UI/Content Script 中直接拼装 `LLMInput`/业务规则（导致测试难、复用差）。
- `core` 里出现 platform 条件分支（例如 `chrome`、`window`、`expo` 等）。

## 6) 可维护性评分（Maintainability Score）

> 评分维度：边界清晰度、循环依赖、耦合热点集中度、重复程度、测试支撑度（基于仓库可见配置）。

- **当前建议评分：7.5 / 10**
  - 加分：Monorepo 清晰；`core` 被独立为依赖下游；`core`/`extension` 使用 `vitest`，具备可测试性基础。
  - 扣分风险：`core` 通过 barrel 导出可能导致边界弱化；extension background/orchestrator 可能出现过度集中；跨端胶水逻辑易重复。

## 7) 改进建议（按优先级）

1. **加“依赖边界守卫”**：为 `core` 明确禁止引入 platform 依赖（可用 eslint rule 或简单 `rg` gate：禁止 `chrome|window|react-native|expo` 等关键字进入 `packages/core/src`）。
2. **拆解 orchestrator 巨石**：将 `browser-extension/src/background` 的职责按“输入采集/状态机/LLM 调用/存储/消息协议”拆分模块，并收敛公共类型到 `core`。
3. **减少 barrel 造成的隐式耦合**：将 `@social-copilot/core` 的导出分组（例如 `@social-copilot/core/llm`、`.../types`），消费者按需导入。
4. **抽出跨端共享胶水层**：新增 `packages/shared`（或下沉至 `core/src/utils`）承载 `LLMManager` 初始化、配置 schema、通用错误映射与重试策略。
5. **引入“重复检测”到 CI（可选）**：把 `scripts/audit-025.mjs` 输出的 duplicates 作为告警阈值（仅提示，不阻断）。
6. **统一 workspace 依赖声明**：`packages/mobile/package.json` 当前用 `@social-copilot/core: file:../core`，建议与 `browser-extension` 一致改为 `workspace:*`，避免未来出现重复安装/解析差异（尤其在 monorepo + bundler 场景）。
