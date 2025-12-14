# 聊天导师（Social Copilot）

本仓库采用 **open-core**：公共核心与客户端开源（MIT），可选的商业/私有增强以“插件”方式接入，不影响开源版构建与使用。

## 目录

- `social-copilot/`：开源社区版（浏览器扩展 + 核心 SDK + 可选移动端预览）
- `private/`：私有增强（默认被 `.gitignore` 忽略，仅保留说明文件；见 `social-copilot/docs/OPEN_CORE.md`）

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
