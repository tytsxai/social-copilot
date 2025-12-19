# GitHub Pages（隐私政策站点）

本目录用于通过 GitHub Pages 对外公开隐私政策页面（便于 Chrome Web Store 提交）。

## 启用方式

1. 推送到 `main/master` 分支
2. GitHub 仓库设置中启用 Pages，并选择 **GitHub Actions** 作为 Source（如未自动启用）
3. 等待 `GitHub Pages (Policies)` workflow 完成

## 注意事项

- Chrome Web Store 要求隐私政策 URL 可公开访问；如果仓库是私有仓库，请确认你的账号/计划支持对外提供 GitHub Pages，或改用独立的公开站点托管（例如单独的 public repo / 自有域名）。
- 若访问返回 404：通常是 Pages 未启用或尚未完成首次部署；先检查 Settings → Pages 与 Actions workflow 的运行结果。

## 更新流程

1. 更新 `social-copilot/docs/PRIVACY.md` 与 `social-copilot/docs/PRIVACY.zh-CN.md`
2. 同步更新 `docs/privacy.html` 与 `docs/privacy.zh-CN.html`（对外发布 HTML）
3. 如新增语言或新增页面，更新 `docs/index.html` 的入口列表
4. 本地预览可直接打开 `docs/index.html`，或使用任意静态服务器

## 访问 URL

页面地址一般为：

- `https://tytsxai.github.io/social-copilot/privacy.html`
- `https://tytsxai.github.io/social-copilot/privacy.zh-CN.html`

入口页：

- `https://tytsxai.github.io/social-copilot/`
