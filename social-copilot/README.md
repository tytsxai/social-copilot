# Social Copilot

[![CI](https://img.shields.io/github/actions/workflow/status/tytsxai/social-copilot/ci.yml?branch=main&label=ci)](https://github.com/tytsxai/social-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tytsxai/social-copilot)](https://github.com/tytsxai/social-copilot/releases)
[![License](https://img.shields.io/github/license/tytsxai/social-copilot)](../LICENSE)

AI 辅助社交伴侣 - 让每一次回复更得体（本地优先、隐私可控）

快速入口： [主页](https://tytsxai.github.io/social-copilot/) · [隐私政策](https://tytsxai.github.io/social-copilot/privacy.zh-CN.html) · [Issues](https://github.com/tytsxai/social-copilot/issues) · [研发文档](docs/README.md)

## 功能特性

- 🤖 **智能回复建议** - 基于对话上下文生成多风格候选回复
- 👤 **联系人画像** - 自动学习并记忆每个联系人的特点
- 💾 **本地存储** - 所有数据默认存储在本地，保护隐私
- ⌨️ **快捷操作** - Alt+S 手动触发，点击即填充
- 🔄 **多模型支持** - 支持 DeepSeek、OpenAI、Claude，自动故障转移
- 📊 **风格学习** - 自动学习用户对每个联系人的回复风格偏好
- 🧭 **思路卡片** - 自动分析对话语气，推荐回复方向并融入提示词
- 📱 **移动端预览** - 内置 Expo 客户端可直连核心 LLM 体验

## 支持平台

| 平台 | 状态 | 说明 |
|------|------|------|
| Telegram Web | ✅ | 支持 K 版和 A 版 |
| WhatsApp Web | ✅ | 完整支持 |
| Slack Web | ✅ | 完整支持 |
| Discord | 🚧 | 计划中 |

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Chrome 或 Edge 浏览器

### 安装与构建

```bash
# 安装依赖
pnpm install

# 构建项目
pnpm build
```

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

### 本地端到端 Smoke（可选）

需要你已在目标网站登录并进入任意聊天视图（否则会判定适配器健康失败）。

```bash
# 构建扩展并跑 Telegram/WhatsApp/Slack 三个平台 smoke
pnpm e2e:smoke

# 仅跑部分平台
SC_E2E_TARGETS=telegram,slack pnpm e2e:smoke

# 指定浏览器可执行文件路径（找不到 Chrome/Edge 时使用）
SC_E2E_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm e2e:smoke
```

### CI/CD

- PR / Push：执行 `lint` / `typecheck` / `test` / `release:extension` 并上传 zip 产物
- Tag：推送 `v<version>` 标签会自动创建 GitHub Release 并附带 zip；如配置以下 secrets 还会自动发布到 Chrome Web Store：`EXTENSION_ID`、`CLIENT_ID`、`CLIENT_SECRET`、`REFRESH_TOKEN`

### 加载扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/browser-extension/dist` 目录

### 配置

1. 点击扩展图标打开设置
2. 勾选「隐私告知」确认（首次使用必选）
3. 选择模型提供商（DeepSeek / OpenAI / Claude）
4. （可选）填写 Base URL（留空则使用默认；仅支持官方域名；不要包含 `/v1`）
5. （可选）填写模型名称（不填则使用默认模型）
6. 输入对应的 API Key
7. （可选）开启备用模型并填写备用 API Key，实现自动故障转移（备用模型也可指定 Base URL / 模型名称）
8. 选择默认回复风格，以及每次生成的回复条数（2 或 3 条）
9. （可选）关闭「收到消息自动生成建议」，仅通过 `Alt+S` 手动触发
10. 保存设置

### 使用

1. 打开支持的聊天网站
2. 默认收到消息时，右下角会自动弹出建议面板（可在设置中关闭自动生成）
3. 先在顶部思路卡片中选择方向（如共情/解决方案/幽默）
4. 点击候选回复即可填充到输入框
5. 按 `Alt+S` 可手动触发建议
6. 按 `Esc` 关闭面板

### 移动端（可选）

预览版移动客户端使用 Expo 直连核心 LLM：

```bash
# 设置公开环境变量供 Expo 读取
EXPO_PUBLIC_LLM_API_KEY=<你的 API Key> \
EXPO_PUBLIC_LLM_PROVIDER=deepseek \
EXPO_PUBLIC_LLM_MODEL=deepseek-v3.2 \
pnpm --filter @social-copilot/mobile start
```

Expo DevTools 启动后，可在模拟器或 Expo Go 扫码运行。需在环境变量 `EXPO_PUBLIC_LLM_API_KEY` 中提供有效密钥；`EXPO_PUBLIC_LLM_PROVIDER` / `EXPO_PUBLIC_LLM_MODEL` 为可选（也可在 App 内切换）。

## 项目结构

```
social-copilot/
├── packages/
│   ├── core/                    # 核心逻辑（跨平台共享）
│   │   └── src/
│   │       ├── types/           # 类型定义
│   │       ├── memory/          # 存储层（IndexedDB）
│   │       ├── llm/             # LLM 接入与管理
│   │       ├── profile/         # 画像更新
│   │       ├── preference/      # 风格偏好管理
│   │       └── thought/         # 思路分析与提示构建
│   └── browser-extension/       # Chrome 扩展
│       ├── src/
│       │   ├── adapters/        # 平台适配器
│       │   ├── background/      # Service Worker
│       │   ├── content-scripts/ # 注入脚本
│       │   ├── popup/           # 设置页面
│       │   └── ui/              # 悬浮面板（含思路卡片）
│       └── manifest.json
├── docs/
│   ├── DEVELOPMENT.md           # 开发指南
│   ├── ARCHITECTURE.md          # 架构设计
│   ├── API.md                   # API 文档
│   ├── PRODUCT_PLAN.md          # 产品规划
│   └── CONTRIBUTING.md          # 贡献指南
└── CHANGELOG.md                 # 更新日志
```

## 回复风格

| 风格 | 说明 | 适用场景 |
|------|------|----------|
| 💗 caring | 关心体贴 | 安慰、关怀、情感支持 |
| 😄 humorous | 幽默风趣 | 轻松聊天、活跃气氛 |
| 😊 casual | 随意轻松 | 日常闲聊、朋友交流 |
| 🧠 rational | 理性客观 | 讨论问题、提供建议 |
| 📝 formal | 正式礼貌 | 工作沟通、正式场合 |

## 开发

```bash
# 开发模式（监听文件变化）
pnpm dev

# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建
pnpm build
```

## 文档

- [文档导航](docs/README.md) - 文档入口与常见任务
- [品牌指南](docs/BRAND.md) - 定位、语气与品牌资产
- [开发指南](docs/DEVELOPMENT.md) - 环境配置、构建流程、调试技巧
- [架构设计](docs/ARCHITECTURE.md) - 系统架构、模块设计、数据流
- [API 文档](docs/API.md) - 核心模块 API 参考
- [配置说明](docs/CONFIGURATION.md) - 配置项、环境变量与安全注意事项
- [内部协议](docs/EXTENSION_PROTOCOL.md) - Popup/Content Script/Background 消息协议
- [运行手册](docs/RUNBOOK.md) - 线上排障、恢复与回滚流程
- [隐私政策](docs/PRIVACY.md) - 数据处理与用户告知（上架用模板）
- [商店文案](docs/STORE_COPY.md) - Chrome Web Store 文案模板
- [提交流程](docs/STORE_SUBMISSION.md) - 商店字段对照与提交说明
- [上线清单](docs/RELEASE_CHECKLIST.md) - Chrome Web Store 发布检查项
- [产品规划](docs/PRODUCT_PLAN.md) - 功能规划、迭代计划
- [贡献指南](docs/CONTRIBUTING.md) - 如何参与贡献
- [更新日志](CHANGELOG.md) - 版本记录与变更说明

## 隐私说明

- 所有聊天数据默认存储在浏览器本地（IndexedDB）
- API Key 仅存储在本地，不会上传
- 仅在生成回复时将必要的上下文发送到 AI 服务（可配置发送条数/字符预算）
- 默认发送前做脱敏（邮箱/手机号/链接）与昵称匿名化（我/对方），可在设置中关闭
- 不收集任何用户行为数据

更详细的说明见：`docs/PRIVACY.md`。

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## License

MIT
