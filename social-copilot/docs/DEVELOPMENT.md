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

### 核心功能

- 🤖 智能回复建议（多风格候选）
- 👤 联系人画像自动学习
- 💾 本地数据持久化（IndexedDB）
- ⌨️ 快捷键操作（Alt+S）
- 🔄 多模型支持（DeepSeek / OpenAI）

---

## 环境准备

### 系统要求

- Node.js >= 18.0.0
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
   - 选择 AI 模型（DeepSeek 或 OpenAI）
   - 输入对应的 API Key
   - 选择默认回复风格（可多选）
3. 点击「保存设置」
4. 状态显示「✓ 已配置，准备就绪」即可使用

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
│   │       │   └── llm.ts       # LLMInput, LLMOutput
│   │       ├── memory/          # 存储层
│   │       │   ├── store.ts     # MemoryStore 接口
│   │       │   └── indexeddb-store.ts  # IndexedDB 实现
│   │       ├── llm/             # LLM 接入
│   │       │   ├── provider.ts  # DeepSeek Provider
│   │       │   └── openai.ts    # OpenAI Provider
│   │       └── profile/         # 画像管理
│   │           └── updater.ts   # 画像自动更新
│   │
│   └── browser-extension/       # Chrome 扩展
│       ├── src/
│       │   ├── adapters/        # 平台适配器
│       │   │   ├── base.ts      # PlatformAdapter 接口
│       │   │   ├── telegram.ts  # Telegram Web 适配
│       │   │   ├── whatsapp.ts  # WhatsApp Web 适配
│       │   │   └── slack.ts     # Slack Web 适配
│       │   ├── background/      # Service Worker
│       │   │   └── index.ts     # 消息处理、LLM 调用
│       │   ├── content-scripts/ # 注入脚本
│       │   │   ├── telegram.ts
│       │   │   ├── whatsapp.ts
│       │   │   └── slack.ts
│       │   ├── popup/           # 设置页面
│       │   │   ├── index.html
│       │   │   └── popup.ts
│       │   └── ui/              # 悬浮面板
│       │       └── copilot-ui.ts
│       ├── styles/
│       │   └── copilot.css
│       └── manifest.json
```

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

### 类型检查

```bash
pnpm typecheck
```

---

## 后续开发计划

### Phase 2：体验优化（预计 2-3 周）

- [x] 拖拽调整面板位置（已实现，位置自动记忆）
- [x] 记住用户偏好的回复风格（选择候选后记忆联系人偏好，下次优先生成该风格）
- [ ] 添加更多模型支持（Claude 等）
- [ ] 模型调用失败自动降级
- [ ] 优化 DOM 选择器稳定性

### Phase 3：高级功能（预计 4+ 周）

- [ ] 向量检索（语义相似度搜索历史对话）
- [ ] Electron 桌面端包装
- [ ] 知识图谱（结构化事实存储）
- [ ] 时机触发提醒（生日、计划等）

### Phase 4：更多平台

- [ ] Discord Web
- [ ] Facebook Messenger
- [ ] Gmail
- [ ] 微信 PC（需要 Windows UIA）

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

## 联系与反馈

如有问题或建议，请提交 Issue 或 PR。
