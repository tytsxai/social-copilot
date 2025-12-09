# 贡献指南

感谢你对 Social Copilot 的关注！欢迎提交 Issue 和 Pull Request。

## 开发环境设置

1. Fork 并克隆仓库
2. 安装依赖：`pnpm install`
3. 构建项目：`pnpm build`
4. 加载扩展到 Chrome 进行测试

详细步骤请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 提交 Issue

提交 Issue 时，请包含以下信息：

### Bug 报告

- 问题描述
- 复现步骤
- 期望行为
- 实际行为
- 环境信息（浏览器版本、操作系统）
- 相关截图或日志

### 功能建议

- 功能描述
- 使用场景
- 期望的实现方式（可选）

## 提交 Pull Request

### 分支命名

- `feature/xxx` - 新功能
- `fix/xxx` - Bug 修复
- `docs/xxx` - 文档更新
- `refactor/xxx` - 代码重构

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

类型（type）：
- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档更新
- `style` - 代码格式（不影响功能）
- `refactor` - 代码重构
- `test` - 测试相关
- `chore` - 构建/工具相关

示例：
```
feat(adapter): add Discord Web adapter
fix(llm): handle API timeout error
docs: update API documentation
```

### PR 检查清单

- [ ] 代码通过类型检查 (`pnpm typecheck`)
- [ ] 代码通过 lint 检查 (`pnpm lint`)
- [ ] 添加了必要的测试
- [ ] 更新了相关文档
- [ ] Commit 信息符合规范

## 代码规范

### TypeScript

- 使用 TypeScript 严格模式
- 为公共 API 添加 JSDoc 注释
- 避免使用 `any` 类型

### 命名规范

- 文件名：kebab-case（如 `llm-manager.ts`）
- 类名：PascalCase（如 `LLMManager`）
- 函数/变量：camelCase（如 `generateReply`）
- 常量：UPPER_SNAKE_CASE（如 `DEFAULT_STYLE_THRESHOLD`）
- 接口：PascalCase，不加 `I` 前缀（如 `LLMProvider`）

### 目录结构

- 每个模块一个目录
- 导出通过 `index.ts` 统一管理
- 测试文件与源文件同目录，命名为 `*.test.ts`

## 添加新功能

### 添加新平台适配器

参考 [API.md](./API.md#platform-adapter-平台适配器) 中的实现指南。

### 添加新 LLM Provider

参考 [API.md](./API.md#llm-模块) 中的实现指南。

## 测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm --filter @social-copilot/core test

# 监听模式
pnpm --filter @social-copilot/core test:watch
```

## 发布流程

1. 更新版本号（`package.json`）
2. 更新 CHANGELOG
3. 创建 Release Tag
4. 构建并打包扩展

## 行为准则

- 尊重所有贡献者
- 保持友善和专业的沟通
- 接受建设性的批评
- 关注项目的最佳利益

## 获取帮助

如有任何问题，欢迎：

- 提交 Issue 讨论
- 查阅现有文档
- 参考代码中的注释和测试
