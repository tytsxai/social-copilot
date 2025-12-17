# Chrome Web Store 文案模板

> 这是一份可直接用于 Chrome Web Store 的文案模板（中文为主，必要处附英文）。
> 发布前请将括号中的占位内容替换为你的信息。

## 简短说明（Short description，最多 132 字符）

为 Telegram/WhatsApp/Slack 提供 AI 回复建议：本地存储、可选长期记忆、支持 DeepSeek/OpenAI/Claude，支持脱敏与发送范围控制。

## 详细说明（Detailed description）

Social Copilot 是一款浏览器扩展，为 Telegram Web、WhatsApp Web、Slack Web 的聊天输入框提供“多风格回复建议”。你可以在收到消息后快速生成 2~3 条候选回复，点击即可填充。

主要功能：

- 智能回复建议：根据上下文生成多风格候选（关心/幽默/随意/理性/正式）
- 思路卡片：自动推荐回复方向（共情/解决方案/幽默/中性），也可手动选择
- 本地存储：聊天记录/偏好/画像默认仅保存在浏览器本地
- 多模型支持：DeepSeek / OpenAI / Claude，支持主备故障转移
- 隐私控制：默认发送前脱敏（邮箱/手机号/链接）并匿名化昵称（我/对方），可在设置中关闭或调整发送上限

使用方式：

1. 在扩展设置中选择模型提供商并填写 API Key
2. 打开支持的网站并进入任意聊天
3. 收到消息时自动弹出建议面板（群聊默认不自动弹出，可配置），或按 `Alt+S` 手动触发

## 数据使用披露（Data usage disclosure，建议在描述中明确）

- 扩展会在你触发生成时，将“必要的对话上下文”发送到你选择的第三方模型服务（如 DeepSeek/OpenAI/Anthropic），用于生成候选回复或提取结构化信息。
- 默认只发送最近 N 条消息（可配置），并对常见敏感信息进行脱敏与昵称匿名化（可关闭）。
- API Key 仅存储在本地，不会上传到任何自建服务器（本项目默认无自建后端）。

## 权限说明（Permissions justification）

- `storage`：保存扩展设置、风格偏好与本地数据索引
- `host_permissions`：
  - `https://web.telegram.org/*` / `https://web.whatsapp.com/*` / `https://app.slack.com/*`：注入内容脚本并在页面展示建议面板
  - `https://api.deepseek.com/*` / `https://api.openai.com/*` / `https://api.anthropic.com/*`：向你选择的模型服务发起请求

## 隐私政策（Privacy policy URL）

请提供可公开访问的隐私政策 URL（模板见仓库 `docs/PRIVACY.md` / `docs/PRIVACY.zh-CN.md`）。

