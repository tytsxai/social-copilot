# P1/P2 修复 - 开发计划

## 概述
修复代码审计中发现的 6 个 P1 中等风险问题和 5 个 P2 低风险问题，涵盖安全防护、并发控制、性能优化和代码质量提升。

## 任务分解

### Task 1: Token 限制改为基于 token 估算
- **ID**: task-1
- **描述**: 将当前基于字符数的 token 限制改为基于实际 token 估算，避免误判和资源浪费
- **文件范围**: packages/core/src/llm/input-budgets.ts, 可能新增 packages/core/src/llm/tokenizer.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test input-budgets --coverage --coverage-reporter=text`
- **测试重点**:
  - 不同长度输入的 token 估算准确性
  - 边界值测试（空输入、超长输入、多语言混合）
  - 与字符数方案的对比验证
  - 性能基准测试（估算耗时 <1ms）

### Task 2: SSRF 防护完善（私网地址校验）
- **ID**: task-2
- **描述**: 在 normalizeBaseUrl 中增加私网地址、本地回环、保留 IP 段的校验，防止 SSRF 攻击
- **文件范围**: packages/core/src/llm/normalize-base-url.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test normalize-base-url --coverage --coverage-reporter=text`
- **测试重点**:
  - 私网地址拦截（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）
  - 本地回环拦截（127.0.0.0/8, ::1）
  - 保留 IP 段拦截（0.0.0.0/8, 169.254.0.0/16, 224.0.0.0/4）
  - DNS 重绑定防护（域名解析后的 IP 校验）
  - 合法公网地址正常通过

### Task 3: JSON 解析防原型污染
- **ID**: task-3
- **描述**: 在 JSON 解析工具中增加 __proto__、constructor、prototype 等危险键的过滤
- **文件范围**: packages/core/src/utils/json.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test json --coverage --coverage-reporter=text`
- **测试重点**:
  - __proto__ 污染尝试被拦截
  - constructor.prototype 污染尝试被拦截
  - 嵌套对象中的危险键过滤
  - 数组中的对象过滤
  - 正常 JSON 解析不受影响

### Task 4: IndexedDB 事务回滚保证
- **ID**: task-4
- **描述**: 为 IndexedDB 操作增加显式事务管理和错误回滚机制
- **文件范围**: packages/core/src/memory/indexeddb-store.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test indexeddb-store --coverage --coverage-reporter=text`
- **测试重点**:
  - 写入失败时事务自动回滚
  - 批量操作部分失败的回滚行为
  - 并发事务的隔离性验证
  - 异常场景下数据一致性保证
  - 事务超时处理

### Task 5: Profile 并发更新消除竞态
- **ID**: task-5
- **描述**: 使用事务锁或乐观锁机制消除 Profile 并发更新的竞态条件
- **文件范围**: packages/core/src/profile/updater.ts
- **依赖**: depends on task-4
- **测试命令**: `pnpm --filter @social-copilot/core test updater --coverage --coverage-reporter=text`
- **测试重点**:
  - 并发更新场景下的数据一致性
  - 乐观锁冲突重试机制
  - 高并发压力测试（10+ 并发更新）
  - 更新失败的错误处理
  - 版本号或时间戳的正确递增

### Task 6: DOM 选择器健壮化
- **ID**: task-6
- **描述**: 为 DOM 选择器增加空值检查、异常捕获和降级策略
- **文件范围**: packages/browser-extension/src/content-scripts/**/*.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/browser-extension test --coverage --coverage-reporter=text`
- **测试重点**:
  - 目标元素不存在时的降级处理
  - DOM 结构变化时的容错能力
  - 选择器异常时的错误捕获
  - 多平台 DOM 结构差异的兼容性
  - 性能影响测试（选择器查询耗时）

### Task 7: ThoughtType 去重
- **ID**: task-7
- **描述**: 清理 ThoughtType 枚举中的重复定义，统一类型系统
- **文件范围**: packages/core/src/types/thought.ts, packages/core/src/types/schemas.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test thought --coverage --coverage-reporter=text`
- **测试重点**:
  - 所有 ThoughtType 引用处编译通过
  - 类型推断正确性验证
  - Schema 验证与类型定义一致性
  - 向后兼容性（如有存储的旧类型值）

### Task 8: 测试覆盖率脚本补齐
- **ID**: task-8
- **描述**: 在根 package.json 和 core 包中补充 test:coverage 脚本
- **文件范围**: package.json, packages/core/package.json
- **依赖**: None
- **测试命令**: `pnpm test:coverage`
- **测试重点**:
  - 根目录执行覆盖率脚本成功
  - 各子包覆盖率报告正确生成
  - 覆盖率阈值配置生效
  - HTML 报告输出路径正确

### Task 9: 向量检索性能优化（小顶堆）
- **ID**: task-9
- **描述**: 使用小顶堆优化 Top-K 向量检索，降低时间复杂度从 O(n log n) 到 O(n log k)
- **文件范围**: packages/core/src/memory/vector-store.ts, packages/core/src/memory/vector-memory-retriever.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test vector --coverage --coverage-reporter=text`
- **测试重点**:
  - Top-K 结果正确性（与排序方案对比）
  - 性能基准测试（1000+ 向量检索耗时）
  - 不同 K 值下的性能表现
  - 边界情况（K > 向量总数）
  - 内存占用对比

### Task 10: 测试时间断言去抖
- **ID**: task-10
- **描述**: 为时间相关的测试断言增加合理的误差容忍范围，避免 CI 环境偶发失败
- **文件范围**: packages/core/src/utils/result.test.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/core test result --coverage --coverage-reporter=text`
- **测试重点**:
  - 时间断言在慢速 CI 环境下稳定通过
  - 误差范围设置合理（建议 ±50ms）
  - 不影响真实时间逻辑错误的检测
  - 多次运行稳定性验证（10+ 次）

### Task 11: 生产日志清理
- **ID**: task-11
- **描述**: 清理浏览器扩展中的 console.log 调试日志，保留必要的错误日志
- **文件范围**: packages/browser-extension/src/**/*.ts
- **依赖**: None
- **测试命令**: `pnpm --filter @social-copilot/browser-extension test && pnpm --filter @social-copilot/browser-extension build`
- **测试重点**:
  - 代码中无 console.log 残留（通过 ESLint 规则检查）
  - 错误日志正常输出（console.error 保留）
  - 构建产物体积减小
  - 功能回归测试通过

## 验收标准
- [ ] 所有 6 个 P1 问题修复完成并通过测试
- [ ] 所有 5 个 P2 问题修复完成并通过测试
- [ ] 单元测试覆盖率 ≥90%
- [ ] 所有测试在 CI 环境稳定通过（连续 3 次无失败）
- [ ] 安全扫描工具无新增告警
- [ ] 性能基准测试无退化（token 估算、向量检索）
- [ ] 代码审查通过（无遗留 TODO 或 FIXME）

## 技术要点
- **Token 估算**: 考虑使用 tiktoken 或 gpt-tokenizer 库，支持多模型 tokenizer
- **SSRF 防护**: 参考 OWASP 指南，校验需在 DNS 解析后进行
- **原型污染**: 使用 Object.create(null) 或递归过滤，考虑性能影响
- **事务管理**: IndexedDB 事务默认自动提交，需显式 abort 实现回滚
- **并发控制**: 优先使用乐观锁（版本号），避免长时间锁定
- **小顶堆**: 可使用现有库（如 heap-js）或自实现，注意稳定性
- **测试稳定性**: 时间断言误差范围建议 50-100ms，根据 CI 环境调整
- **日志清理**: 配置 ESLint 规则 `no-console: ["error", { allow: ["warn", "error"] }]`
- **覆盖率配置**: Vitest 使用 `--coverage.threshold.lines=90` 等参数
- **依赖关系**: Task 5 必须在 Task 4 完成后执行，其余任务可并行开发
