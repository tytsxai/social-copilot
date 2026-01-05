# Social Copilot 开发文档

## 目录

1. [项目概述](#项目概述)
2. [环境准备](#环境准备)
3. [构建与安装](#构建与安装)
4. [功能测试](#功能测试)
5. [开发指南](#开发指南)
6. [后续开发计划](#后续开发计划)
7. [故障排除](#故障排除)

---

## 项目概述

Social Copilot 是一个 AI 辅助社交伴侣浏览器扩展，为聊天应用提供智能回复建议。

### 当前支持平台

| 平台 | 状态 | 说明 |
|------|------|------|
| Telegram Web | ✅ 已完成 | 支持 K 版和 A 版 |
| WhatsApp Web | ✅ 已完成 | 基础功能完成 |
| Slack Web | ✅ 已完成 | 基础功能完成 |
| 移动端预览（Expo） | ✅ 可用 | 直连核心 LLM，适合调试/演示 |

### 核心功能

- 🤖 智能回复建议（多风格候选）
- 👤 联系人画像自动学习
- 💾 本地数据持久化（IndexedDB）
- ⌨️ 快捷键操作（Alt+S）
- 🔄 多模型支持（DeepSeek / OpenAI / Claude）
- 🔀 自动故障转移（主备模型切换）
- 📊 风格偏好学习（自动记忆用户选择）
- 🧭 思路卡片（根据语气推荐回复方向并注入提示词）

---

## 环境准备

### 系统要求

- Node.js >= 18.0.0（推荐 Node 20；仓库提供 `social-copilot/.nvmrc`）
- pnpm >= 8.0.0
- Chrome 或 Edge 浏览器

### 安装 pnpm

如果尚未安装 pnpm：

```bash
# 使用 npm 安装
npm install -g pnpm

# 或使用 corepack（Node.js 16.13+）
corepack enable
corepack prepare pnpm@latest --activate
```

### 获取 API Key

选择以下任一模型服务：

**DeepSeek（推荐，性价比高）**
1. 访问 https://platform.deepseek.com/
2. 注册账号并登录
3. 在 API Keys 页面创建新密钥
4. 复制 `sk-` 开头的密钥

**OpenAI**
1. 访问 https://platform.openai.com/api-keys
2. 登录并创建新密钥
3. 复制 `sk-` 开头的密钥

**Claude（Anthropic）**
1. 访问 https://console.anthropic.com/
2. 登录并创建新密钥
3. 复制 `sk-ant-` 开头的密钥

---

## 构建与安装

### 1. 安装依赖

```bash
cd social-copilot
pnpm install
```

### 2. 构建项目

```bash
pnpm build
```

构建成功后，输出目录为 `packages/browser-extension/dist`

### 发布打包（Chrome Web Store 上传用）

```bash
# 生成 release 构建 + 校验 + zip
pnpm release:extension
```

产物输出：`packages/browser-extension/release/social-copilot-<version>.zip`。

### 本地 CI（推荐）

```bash
# 一键跑：lint + typecheck + test + release 打包
pnpm ci:local
```

### CI/CD（GitHub Actions）

- PR / Push：执行 `lint` / `typecheck` / `test` / `release:extension` 并上传 zip 产物
- Tag：推送 `v<version>` 标签会自动创建 GitHub Release 并附带 zip；如配置以下 secrets 还会自动发布到 Chrome Web Store：`EXTENSION_ID`、`CLIENT_ID`、`CLIENT_SECRET`、`REFRESH_TOKEN`

### 3. 加载扩展到 Chrome

1. 打开 Chrome 浏览器
2. 地址栏输入 `chrome://extensions/` 并回车
3. 开启右上角「开发者模式」开关
4. 点击「加载已解压的扩展程序」按钮
5. 选择目录：`social-copilot/packages/browser-extension/dist`
6. 扩展加载成功后，工具栏会出现 Social Copilot 图标

### 4. 配置扩展

1. 点击工具栏的 Social Copilot 图标
2. 在「设置」页面：
   - 选择模型提供商（DeepSeek / OpenAI / Claude）
   - （可选）填写模型名称（不填则使用默认模型）
   - 输入对应的 API Key
   - （可选）开启备用模型并填写备用 API Key，启用自动故障转移（备用模型也可指定模型名称）
   - 选择默认回复风格（可多选）和回复条数（2/3）
3. 点击「保存设置」
4. 状态显示「✓ 已配置，准备就绪」即可使用

### 5. 运行移动端预览（可选）

Expo 客户端用于快速验证核心 LLM 流程：

```bash
# 将 API Key 通过环境变量传递给 Expo
EXPO_PUBLIC_LLM_API_KEY=<你的 API Key> \
EXPO_PUBLIC_LLM_PROVIDER=deepseek \
EXPO_PUBLIC_LLM_MODEL=deepseek-v3.2 \
pnpm --filter @social-copilot/mobile start
```

DevTools 打开后可选择模拟器或使用 Expo Go 扫码运行。必须设置 `EXPO_PUBLIC_LLM_API_KEY`；`EXPO_PUBLIC_LLM_PROVIDER` / `EXPO_PUBLIC_LLM_MODEL` 为可选（也可在 App 内切换）。注意：此方式仅适用于开发预览，生产环境请使用后端代理托管密钥。

### 生产代理示例（移动端）

生产环境请使用后端代理，客户端仅携带用户会话令牌。以下是最小示例（仅示意，需自行加鉴权/限流/审计）：

```ts
import express from 'express';

const app = express();
app.use(express.json());

app.post('/llm/proxy', async (req, res) => {
  // TODO: verify user session token
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(req.body),
  });

  res.status(resp.status).json(await resp.json());
});

app.listen(3000);
```

---

## 功能测试

### 测试 Telegram Web

1. 打开 https://web.telegram.org/
2. 登录你的 Telegram 账号
3. 进入任意聊天
4. 收到新消息时，右下角会自动弹出建议面板
5. 或按 `Alt+S` 手动触发建议
6. 点击候选回复，文本会自动填充到输入框

### 测试 WhatsApp Web

1. 打开 https://web.whatsapp.com/
2. 扫码登录
3. 进入任意聊天
4. 操作同上

### 测试 Slack Web

1. 打开 https://app.slack.com/
2. 登录你的 Slack 工作区
3. 进入任意频道或私聊
4. 操作同上

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + S` | 手动触发回复建议 |
| `Esc` | 关闭建议面板 |

---

## 开发指南

### 项目结构

```
social-copilot/
├── packages/
│   ├── core/                    # 核心逻辑（跨平台共享）
│   │   └── src/
│   │       ├── types/           # 类型定义
│   │       │   ├── contact.ts   # ContactKey, ContactProfile
│   │       │   ├── message.ts   # Message, ConversationContext
│   │       │   ├── llm.ts       # LLMInput, LLMOutput
│   │       │   ├── preference.ts # StylePreference
│   │       │   └── thought.ts   # ThoughtType, THOUGHT_CARDS
│   │       ├── memory/          # 存储层
│   │       │   ├── store.ts     # MemoryStore 接口
│   │       │   └── indexeddb-store.ts  # IndexedDB 实现
│   │       ├── llm/             # LLM 接入
│   │       │   ├── provider.ts  # DeepSeek Provider
│   │       │   ├── openai.ts    # OpenAI Provider
│   │       │   ├── claude.ts    # Claude Provider
│   │       │   └── llm-manager.ts # 模型管理与故障转移
│   │       ├── profile/         # 画像管理
│   │       │   └── updater.ts   # 画像自动更新
│   │       ├── preference/      # 偏好管理
│   │       │   └── manager.ts   # 风格偏好学习
│   │       └── thought/         # 思路分析
│   │           ├── analyzer.ts  # 思路推荐（共情/方案/幽默/中性）
│   │           ├── prompt-builder.ts # 带思路提示的 LLM 输入构建
│   │           └── preference-manager.ts # 思路偏好管理
│   ├── browser-extension/       # Chrome 扩展
│   │   ├── src/
│   │   │   ├── adapters/        # 平台适配器
│   │   │   │   ├── base.ts      # PlatformAdapter 接口
│   │   │   │   ├── telegram.ts  # Telegram Web 适配
│   │   │   │   ├── whatsapp.ts  # WhatsApp Web 适配
│   │   │   │   └── slack.ts     # Slack Web 适配
│   │   │   ├── background/      # Service Worker
│   │   │   │   └── index.ts     # 消息处理、LLM 调用
│   │   │   ├── content-scripts/ # 注入脚本
│   │   │   │   ├── telegram.ts
│   │   │   │   ├── whatsapp.ts
│   │   │   │   └── slack.ts
│   │   │   ├── popup/           # 设置页面
│   │   │   │   ├── index.html
│   │   │   │   └── popup.ts
│   │   │   └── ui/              # 悬浮面板
│   │   │       ├── copilot-ui.ts      # 总控组件（拖拽/刷新/候选展示）
│   │   │       └── thought-cards.ts   # 思路卡片组件
│   │   ├── styles/
│   │   │   └── copilot.css
│   │   └── manifest.json
│   └── mobile/                  # Expo 客户端，直连核心 LLM 体验
│       ├── App.tsx
│       └── src/
│           ├── adapters/        # LLMManager 封装
│           └── screens/         # Chat / Settings 界面
├── docs/
│   ├── DEVELOPMENT.md           # 开发指南（本文档）
│   ├── ARCHITECTURE.md          # 架构设计
│   ├── API.md                   # API 文档
│   ├── PRODUCT_PLAN.md          # 产品规划
│   └── CONTRIBUTING.md          # 贡献指南
```

> 📖 更多架构细节请参考 [ARCHITECTURE.md](./ARCHITECTURE.md)，API 参考请查看 [API.md](./API.md)

### 开发模式

```bash
# 监听文件变化，自动重新构建
pnpm dev
```

修改代码后，需要在 Chrome 扩展页面点击刷新按钮重新加载扩展。

### 添加新平台适配器

1. 在 `packages/browser-extension/src/adapters/` 创建新文件，如 `discord.ts`
2. 实现 `PlatformAdapter` 接口
3. 在 `adapters/index.ts` 注册适配器
4. 创建对应的 content script
5. 更新 `manifest.json` 添加 content_scripts 配置
6. 更新 `vite.config.ts` 添加入口

> 📖 详细的适配器实现指南请参考 [API.md](./API.md#platform-adapter-平台适配器)

### 添加新 LLM Provider

1. 在 `packages/core/src/llm/` 创建新文件
2. 实现 `LLMProvider` 接口
3. 在 `llm-manager.ts` 的 `createProvider` 中注册
4. 更新 `ProviderType` 类型

> 📖 详细的 Provider 实现指南请参考 [API.md](./API.md#llm-模块)

### 思路模块

- `ThoughtAnalyzer`：根据 `ConversationContext` 自动推荐思路方向（共情/方案/幽默/中性）
- `ThoughtAwarePromptBuilder`：将思路方向转换为 `LLMInput` 的 `thoughtHint`，可指定语言
- `THOUGHT_CARDS`：预设的思路卡片文案，可直接用于 UI 展示

```ts
import { ThoughtAnalyzer, ThoughtAwarePromptBuilder, THOUGHT_CARDS } from '@social-copilot/core';

const analyzer = new ThoughtAnalyzer();
const builder = new ThoughtAwarePromptBuilder();

const analysis = analyzer.analyze(context);
const bestThought = analysis.recommended[0];
const llmInput = builder.buildInput(context, profile, styles, bestThought, 'zh');
// llmInput.thoughtHint 会自动附加到提示词
```

> 📖 更多用法请参考 [API.md](./API.md#thought-思路模块)

### 类型检查

```bash
pnpm typecheck
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 监听模式（开发时使用）
pnpm --filter @social-copilot/core test:watch
```

---

## 后续开发计划

### Phase 2：体验优化 ✅ 已完成

- [x] 拖拽调整面板位置（已实现，位置自动记忆）
- [x] 记住用户偏好的回复风格（选择候选后记忆联系人偏好，下次优先生成该风格）
- [x] 添加更多模型支持（Claude）
- [x] 模型调用失败自动降级（LLMManager 实现）
- [x] 思路卡片功能（根据上下文推荐回复方向并在提示词中生效）

### Phase 3：高级功能（进行中）

- [ ] 优化 DOM 选择器稳定性
- [ ] 向量检索（语义相似度搜索历史对话）
- [ ] Electron 桌面端包装
- [ ] 知识图谱（结构化事实存储）
- [ ] 时机触发提醒（生日、计划等）

### Phase 4：更多平台

- [ ] Discord Web
- [ ] Facebook Messenger
- [ ] Gmail
- [ ] 微信 PC（需要 Windows UIA）

> 📖 详细的产品规划请参考 [PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

---

## 故障排除

### 扩展加载失败

**问题**：提示「清单文件缺失或不可读取」

**解决**：确保选择的是 `packages/browser-extension/dist` 目录，不是 `packages/core/dist`

---

### 建议面板不显示

**可能原因**：
1. API Key 未配置
2. 网站 DOM 结构变化导致适配器失效

**排查步骤**：
1. 点击扩展图标，检查状态是否显示「已配置」
2. 打开 DevTools (F12)，查看 Console 是否有错误
3. 检查是否有 `[Social Copilot]` 开头的日志

---

### 消息提取不到

**可能原因**：网站更新导致 DOM 选择器失效

**解决**：
1. 打开 DevTools，检查消息元素的 class 和结构
2. 更新对应适配器的选择器
3. 重新构建并刷新扩展

---

### API 调用失败

**可能原因**：
1. API Key 无效或过期
2. 网络问题
3. API 配额用尽

**排查**：
1. 检查 DevTools Console 中的错误信息
2. 确认 API Key 正确
3. 检查 API 服务商的用量页面

---

### 快捷键不生效

**可能原因**：快捷键被其他扩展或系统占用

**解决**：
1. 检查是否有其他扩展使用 Alt+S
2. 尝试使用 Ctrl+Shift+S 作为替代

---

## 调试技巧

### 查看 Background Script 日志

1. 打开 `chrome://extensions/`
2. 找到 Social Copilot
3. 点击「Service Worker」链接
4. 在打开的 DevTools 中查看 Console

### 查看 Content Script 日志

1. 在目标网站打开 DevTools (F12)
2. 切换到 Console 标签
3. 搜索 `[Social Copilot]` 查看相关日志

### 检查 IndexedDB 数据

1. 在目标网站打开 DevTools
2. 切换到 Application 标签
3. 左侧找到 IndexedDB > social-copilot
4. 可以查看 messages 和 profiles 存储的数据

---

## 相关文档

- [README.md](../README.md) - 项目概述与快速开始
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构设计
- [API.md](./API.md) - 核心模块 API 参考
- [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) - 产品规划与迭代计划
- [CONTRIBUTING.md](./CONTRIBUTING.md) - 贡献流程和规范
- [CHANGELOG.md](../CHANGELOG.md) - 版本更新记录

## 联系与反馈

如有问题或建议，请提交 Issue 或 PR。
