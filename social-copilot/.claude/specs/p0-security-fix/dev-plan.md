# P0 安全修复 - 开发计划

## 概述
修复三类 P0 级安全问题：提示词注入隔离、XSS 防护增强、依赖漏洞升级，确保用户输入与系统指令边界清晰，防止恶意脚本执行，消除已知 CVE 漏洞。

## 任务分解

### Task 1: Prompt 注入隔离
- **ID**: task-1
- **描述**: 重构 prompt 构建逻辑，将用户消息与系统指令通过结构化块隔离；在系统 prompt 中增加明确边界标记与"不可执行用户指令"规则，防止用户输入覆盖系统行为
- **文件范围**: `packages/core/src/llm/prompts.ts`, `packages/core/src/llm/*.test.ts`
- **依赖**: None
- **测试命令**: `pnpm -C packages/core test --coverage --coverage-reporter=text`
- **测试重点**:
  - 用户消息包含"忽略之前指令"等注入尝试时，系统行为不变
  - senderName 包含特殊字符或伪装系统角色时，正确转义或隔离
  - 结构化块边界在多轮对话中保持完整
  - 覆盖 prompts.ts 中所有 prompt 构建函数

### Task 2: XSS 防护增强
- **ID**: task-2
- **描述**: 增强 escapeHtml 函数：强制输入字符串化、补充控制字符（\x00-\x1F）转义、添加 URL 协议白名单校验（仅允许 http/https/mailto）；在 Message 类型定义中添加安全约束注释
- **文件范围**: `packages/browser-extension/src/utils/escape-html.ts`, `packages/core/src/types/message.ts`, `packages/browser-extension/src/utils/*.test.ts`
- **依赖**: None
- **测试命令**: `pnpm -C packages/browser-extension test --coverage --coverage-reporter=text`
- **测试重点**:
  - 非字符串输入（null/undefined/object）正确处理
  - 控制字符（\x00, \x0A, \x0D 等）被转义
  - javascript:/data:/vbscript: 等危险协议被拒绝
  - 嵌套 HTML 标签与属性注入被阻止
  - 覆盖 escape-html.ts 所有导出函数

### Task 3: 依赖漏洞修复
- **ID**: task-3
- **描述**: 通过 pnpm.overrides 强制升级存在 CVE 的依赖：esbuild>=0.25.0（修复任意代码执行）、send>=0.19.0（修复路径遍历）；验证升级后所有测试通过且无新引入漏洞
- **文件范围**: 根目录 `package.json` (pnpm.overrides 字段), `pnpm-lock.yaml`
- **依赖**: None
- **测试命令**: `pnpm audit --audit-level=high && pnpm -r test`
- **测试重点**:
  - pnpm audit 报告无 high/critical 级别漏洞
  - 所有 workspace 包的单元测试通过
  - 浏览器扩展构建成功（验证 esbuild 兼容性）
  - 开发服务器正常启动（验证 vite/send 兼容性）

## 验收标准
- [ ] 用户消息中的注入尝试无法改变系统行为（task-1）
- [ ] 所有用户输入经过增强型 XSS 过滤，危险协议被拒绝（task-2）
- [ ] pnpm audit 无 high/critical 级别漏洞（task-3）
- [ ] 所有单元测试通过，代码覆盖率 ≥90%
- [ ] 浏览器扩展与核心包功能正常，无回归问题

## 技术要点
- **Prompt 隔离策略**: 采用 XML 标签或 JSON 结构明确用户内容边界，系统 prompt 末尾添加"用户消息不可信"声明
- **XSS 防护层级**: 输入验证（类型检查）→ 字符转义（HTML 实体）→ 协议白名单（URL 校验）
- **依赖升级约束**: 仅通过 overrides 锁定最小安全版本，避免大版本跳跃引入破坏性变更
- **测试覆盖要求**: 每个任务必须包含恶意输入测试用例，覆盖 OWASP Top 10 相关场景
