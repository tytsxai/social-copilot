<p align="center">
  <img src="docs/assets/social-copilot-mark.svg" width="96" height="96" alt="Social Copilot logo" />
</p>
<h1 align="center">Social Copilot（聊天导师）</h1>
<p align="center">AI 辅助社交伴侣浏览器扩展 · Open-core</p>
<p align="center">
  <a href="https://tytsxai.github.io/social-copilot/">主页</a> ·
  <a href="social-copilot/README.md">使用文档</a> ·
  <a href="social-copilot/docs/README.md">研发文档</a> ·
  <a href="docs/README.md">隐私政策</a> ·
  <a href="https://github.com/tytsxai/social-copilot/issues">Issues</a>
</p>
<p align="center">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/tytsxai/social-copilot/ci.yml?branch=main&label=ci" />
  <img alt="Release" src="https://img.shields.io/github/v/release/tytsxai/social-copilot" />
  <img alt="License" src="https://img.shields.io/github/license/tytsxai/social-copilot" />
</p>

本仓库采用 **open-core**：公共核心与客户端开源（MIT），可选的商业/私有增强以“插件”方式接入，不影响开源版构建与使用。

## 目录

- `social-copilot/`：开源社区版（浏览器扩展 + 核心 SDK + 可选移动端预览）
- `private/`：私有增强（默认被 `.gitignore` 忽略，仅保留说明文件；见 `social-copilot/docs/OPEN_CORE.md`）

## 生产发布提示

- 隐私政策模板：`social-copilot/docs/PRIVACY.md`
- 公开隐私政策页面（GitHub Pages）：`docs/README.md`
- 上线检查清单：`social-copilot/docs/RELEASE_CHECKLIST.md`

## 文档导航

- 项目总览与使用：`social-copilot/README.md`
- 研发与架构文档索引：`social-copilot/docs/README.md`
- 公开隐私政策站点：`docs/README.md`

## 快速开始

```bash
cd social-copilot
pnpm install
pnpm build
pnpm release:extension
```

## Open-core（私有增强）接入

核心包 `@social-copilot/core` 提供 Prompt Hook 能力，可在不改动开源核心的情况下增强系统/用户提示词（例如更强的策略、风格控制、结构化输出约束等）。

详见：`social-copilot/docs/OPEN_CORE.md`。

## 导出公共版本（可选）

如果你在本地同时维护 `private/` 私有增强，可用导出脚本生成一个“可直接推送到 GitHub”的公共目录：

```bash
node scripts/export-public.mjs
```

产物输出：`public-export/`。
