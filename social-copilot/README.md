# Social Copilot

AI 辅助社交伴侣 - 为聊天应用提供智能回复建议

## 功能特性

- 🤖 **智能回复建议** - 基于对话上下文生成多风格候选回复
- 👤 **联系人画像** - 自动学习并记忆每个联系人的特点
- 💾 **本地存储** - 所有数据默认存储在本地，保护隐私
- ⌨️ **快捷操作** - Alt+S 手动触发，点击即填充

## 支持平台

- ✅ Telegram Web (K 版 & A 版)
- ✅ WhatsApp Web
- ✅ Slack Web

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 构建

```bash
pnpm build
```

### 加载扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/browser-extension/dist` 目录

### 配置

1. 点击扩展图标打开设置
2. 选择 AI 模型（DeepSeek 或 OpenAI）
3. 输入对应的 API Key
4. 选择默认回复风格
5. 保存设置

### 使用

1. 打开支持的聊天网站
2. 收到消息时，右下角会自动弹出建议面板
3. 点击候选回复即可填充到输入框
4. 按 `Alt+S` 可手动触发建议
5. 按 `Esc` 关闭面板

## 项目结构

```
social-copilot/
├── packages/
│   ├── core/                    # 核心逻辑（跨平台共享）
│   │   └── src/
│   │       ├── types/           # 类型定义
│   │       ├── memory/          # 存储层（IndexedDB）
│   │       ├── llm/             # LLM 接入（DeepSeek/OpenAI）
│   │       └── profile/         # 画像更新
│   └── browser-extension/       # Chrome 扩展
│       ├── src/
│       │   ├── adapters/        # 平台适配器
│       │   ├── background/      # Service Worker
│       │   ├── content-scripts/ # 注入脚本
│       │   ├── popup/           # 设置页面
│       │   └── ui/              # 悬浮面板
│       └── manifest.json
```

## 回复风格

| 风格 | 说明 |
|------|------|
| 💗 caring | 关心体贴 |
| 😄 humorous | 幽默风趣 |
| 😊 casual | 随意轻松 |
| 🧠 rational | 理性客观 |
| 📝 formal | 正式礼貌 |

## 开发

```bash
# 开发模式（监听文件变化）
pnpm dev

# 类型检查
pnpm typecheck

# 构建
pnpm build
```

## 隐私说明

- 所有聊天数据默认存储在浏览器本地（IndexedDB）
- API Key 仅存储在本地，不会上传
- 仅在生成回复时将必要的上下文发送到 AI 服务

## License

MIT
