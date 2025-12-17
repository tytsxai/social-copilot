# Chrome Web Store 提交流程对照表

> 用于把仓库内容映射到 Chrome Web Store 提交流程中的必填/常见字段。

## 1) 物料与元信息

- 扩展名称：`Social Copilot`
- 版本号：`social-copilot/packages/browser-extension/manifest.json` 的 `version`
- 图标：`social-copilot/packages/browser-extension/src/icons/`（构建产物会打包）
- 截图：需要你自行准备（建议包含：设置页、面板、思路卡片、联系人页）

## 2) 描述与披露

- 简短说明：见 `docs/STORE_COPY.md`
- 详细说明：见 `docs/STORE_COPY.md`
- 数据使用披露（重要）：建议直接复用 `docs/STORE_COPY.md` 中的 “数据使用披露” 段落
- 权限说明：见 `docs/STORE_COPY.md` 的 “权限说明”

## 3) 隐私政策 URL（通常必填）

- 模板：`docs/PRIVACY.md`（英文）与 `docs/PRIVACY.zh-CN.md`（中文）
- 你需要将其部署到一个可公开访问的 URL（例如你的官网、GitHub Pages 等）

## 4) 权限与域名审计（对应 manifest）

文件：`packages/browser-extension/manifest.json`

- `permissions`: 仅使用 `storage`
- `host_permissions`:
  - 站点：Telegram/WhatsApp/Slack（用于注入与展示）
  - API：DeepSeek/OpenAI/Anthropic（用于请求第三方模型服务）

如你需要减少安装时的站点授权范围，可考虑将站点域名改为可选权限（optional host permissions）并在运行时请求授权（需要额外开发与 UX）。

## 5) 构建与提交包

在 `social-copilot/` 目录执行：

```bash
pnpm ci:local
pnpm release:extension
```

产物：`packages/browser-extension/release/social-copilot-<version>.zip`

## 6) 发布后验证清单

见：`docs/RELEASE_CHECKLIST.md`

