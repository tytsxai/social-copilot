# Configuration（配置项与环境变量）

> 本文档聚焦“维护安全”：把散落在代码中的配置项、默认值与风险集中说明，避免误改/误配。

## 1. Browser Extension（运行时配置）

运行时配置主要存储在 `chrome.storage.local`（设置/开关）与 `chrome.storage.session`（默认的临时密钥）。

### 1.1 `chrome.storage.local`（设置项）

这些 key 由设置页写入，Background 在启动时读取（见 `packages/browser-extension/src/background/index.ts`）。

| Key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `provider` | `'deepseek' \| 'openai' \| 'claude'` | `'deepseek'` | 主用模型提供商 |
| `baseUrl` | `string` | `undefined` | 可选：覆盖主用提供商 Base URL（不要包含 `/v1`） |
| `model` | `string` | `undefined` | 可选：覆盖默认模型名 |
| `styles` | `ReplyStyle[]` | `['caring','humorous','casual']` | 默认候选回复风格列表 |
| `suggestionCount` | `2 \| 3` | `3` | 每次生成候选条数 |
| `language` | `'zh' \| 'en' \| 'auto'` | `'auto'` | 输出语言偏好（auto 推荐） |
| `autoTrigger` | `boolean` | `true` | 收到消息是否自动生成建议 |
| `autoInGroups` | `boolean` | `false` | 群聊是否自动生成建议（仍可手动触发） |
| `privacyAcknowledged` | `boolean` | `false` | 是否已确认隐私告知（未确认不会调用第三方模型） |
| `redactPii` | `boolean` | `true` | 出站前脱敏（邮箱/手机号/链接等） |
| `anonymizeSenders` | `boolean` | `true` | 出站前匿名化昵称（我/对方） |
| `contextMessageLimit` | `number` | `10` | 发送给模型的最近消息条数（含当前消息） |
| `maxCharsPerMessage` | `number` | `500` | 单条消息出站字符上限 |
| `maxTotalChars` | `number` | `4000` | 整体上下文出站字符预算 |
| `enableFallback` | `boolean` | `false` | 是否启用备用模型 |
| `fallbackProvider` | `ProviderType` | `provider` | 备用模型提供商（不填则沿用主用） |
| `fallbackBaseUrl` | `string` | `undefined` | 可选：覆盖备用提供商 Base URL（不要包含 `/v1`） |
| `fallbackModel` | `string` | `undefined` | 可选：备用模型名 |
| `enableMemory` | `boolean` | `false` | 是否启用“长期记忆摘要”（默认关闭） |
| `persistApiKey` | `boolean` | `false` | 是否持久化存储 API Key（默认不持久化） |
| `debugEnabled` | `boolean` | `false` | 是否启用诊断事件的 console 输出 |

### 1.2 API Key 存储策略（安全相关）

默认策略：**不持久化 API Key**，以降低浏览器本地泄漏风险。

- 当 `persistApiKey = false`（默认）：
  - 优先写入 `chrome.storage.session`：`apiKey` / `fallbackApiKey`
  - 若浏览器/环境不支持 `storage.session`，退化为写入 `chrome.storage.local` 的临时 key：
    - `__sc_session_apiKey`
    - `__sc_session_fallbackApiKey`
  - 这些临时 key 会在浏览器启动时清理（Background 监听 `chrome.runtime.onStartup`）。
- 当 `persistApiKey = true`：
  - 写入 `chrome.storage.local` 的 `apiKey` / `fallbackApiKey`
  - 同时会清理 session key，确保只有一个来源

诊断日志（可观测性）：
- `chrome.storage.local` 内部 key：`__sc_diagnostics_v1`
- 内容：最近 N 条诊断事件（ring buffer，默认 N=200），不包含原文对话与 API Key（仅长度/枚举/错误栈）
- 用途：设置页「复制诊断 / 下载诊断 JSON」；可通过「清空诊断日志」或「清除所有数据」删除
- 诊断导出包含数据库健康状态与配置摘要（脱敏，仅保留开关/枚举/长度信息）

风险提示：
- `persistApiKey=true` 便于长期使用，但 API Key 会长期驻留在本地存储中；建议仅在可信设备上启用。
- 即使第三方服务在错误信息中回显密钥，扩展的诊断导出也会对 `sk-...` / `sk-ant-...` 等片段做打码处理，避免泄漏。

### 1.3 面板位置存储

悬浮面板位置按站点 host 分开存储：

- Key 模式：`sc-panel-pos-<host>`
- Value：`{ top?: number; left?: number }`

代码位置：`packages/browser-extension/src/ui/copilot-ui.ts`

### 1.4 数据备份与恢复（重要：避免清库导致数据丢失）

扩展提供“本地数据备份/恢复”能力，用于在迁移失败、误清数据、换机等场景下尽量保留个性化数据。

- 入口：设置页「关于」→「备份与恢复」
- 导出内容（JSON）：联系人画像、风格偏好、长期记忆、以及更新计数器
- 不包含：API Key、原文对话消息（不会导出 IndexedDB 的 `messages` 内容）

风险提示：
- 备份文件仍可能包含敏感信息（画像/记忆为对话提炼结果），请妥善保管

## 2. IndexedDB（本地数据存储）

核心数据默认保存在浏览器 IndexedDB（画像/消息/偏好/长期记忆）。

- DB 名：`social-copilot`
- 主要对象仓库：`messages` / `profiles` / `stylePreferences` / `contactMemories`
- 消息保留策略（防止长期膨胀）：
  - 单联系人上限：`MAX_MESSAGES_PER_CONTACT = 2000`
  - 全局上限：`MAX_TOTAL_MESSAGES = 50000`（按时间淘汰最旧消息）

说明：
- 本项目在 IndexedDB 中还创建了 `settings` store（历史/预留）；目前运行时配置仍以 `chrome.storage.local` 为准。

## 3. 开发/构建环境变量

### 3.1 Release 构建

| 变量 | 默认 | 说明 |
|---|---|---|
| `SC_RELEASE` | `0` | `1` 表示 release 构建（通常会关闭 sourcemap 等） |

### 3.2 E2E Smoke（Playwright）

| 变量 | 说明 |
|---|---|
| `SC_E2E_TARGETS` | 目标站点列表：`telegram,whatsapp,slack`（不填则全跑） |
| `SC_E2E_CHROME_PATH` | 指定 Chrome/Edge 可执行文件路径 |
| `SC_E2E_USER_DATA_DIR` | 指定 user-data-dir（复用已登录态） |
| `SC_E2E_OUT_DIR` | 输出目录（日志/截图等） |
| `SC_E2E_TELEGRAM_URL` / `SC_E2E_WHATSAPP_URL` / `SC_E2E_SLACK_URL` | 可选：覆盖默认访问 URL |

### 3.3 本地 CI 脚本

| 变量 | 说明 |
|---|---|
| `FORCE_INSTALL` | `1` 强制执行 `pnpm install`（见 `scripts/ci-local.mjs`） |

## 4. Mobile（Expo）环境变量（仅预览/调试）

这些变量会被 Expo 注入到客户端，属于“公开环境变量”（`EXPO_PUBLIC_*`）。

| 变量 | 必填 | 说明 |
|---|---:|---|
| `EXPO_PUBLIC_LLM_API_KEY` | 是 | 预览版直连 LLM 的 API Key |
| `EXPO_PUBLIC_LLM_PROVIDER` | 否 | `deepseek/openai/claude` |
| `EXPO_PUBLIC_LLM_MODEL` | 否 | 覆盖默认模型 |

风险提示：
- 不要在发布给他人的移动端构建中使用真实生产 Key（它会进入客户端包内/环境中）。

## 5. CI/CD Secrets（GitHub Actions）

Chrome Web Store 自动发布（可选）依赖以下 secrets（见 `.github/workflows/release-extension.yml`）：

- `EXTENSION_ID`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `REFRESH_TOKEN`
