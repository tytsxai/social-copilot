# 测试策略文档

本文档介绍 Social Copilot 的测试架构和策略。

## 测试框架

- **单元测试**: Vitest
- **E2E 测试**: Playwright (smoke tests)
- **覆盖率工具**: c8

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定包测试
pnpm --filter @social-copilot/core test

# 生成覆盖率报告
pnpm test:coverage
```

## 测试结构

```
packages/
├── core/src/
│   ├── llm/*.test.ts
│   ├── memory/*.test.ts
│   └── thought/*.test.ts
└── browser-extension/src/
    ├── popup/*.test.ts
    └── utils/*.test.ts
```

## 测试规范

### 命名约定

- 测试文件: `*.test.ts`
- 描述块: 使用中文描述功能

### 覆盖要求

| 模块 | 目标覆盖率 |
|------|-----------|
| core | ≥80% |
| extension | ≥70% |

---

**相关文档**: [开发指南](./DEVELOPMENT.md)
