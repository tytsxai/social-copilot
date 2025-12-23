# UI Visual Polish - Development Plan

## Overview
对浏览器扩展的弹出窗口（popup）和悬浮面板（floating panel）进行视觉回归修复和交互优化，统一样式系统，增强可访问性，并添加深色模式支持。

## Task Breakdown

### Task 1: Popup 基础控件状态规范化
- **ID**: task-1
- **Description**: 规范化 popup 中所有按钮、标签页、输入框的交互状态（hover/active/focus-visible），统一滚动条样式，确保视觉反馈一致性
- **File Scope**: `packages/browser-extension/src/popup/index.html`
- **Dependencies**: None
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 验证所有交互元素的状态类名正确应用
  - 测试键盘导航时 focus-visible 样式生效
  - 确认滚动条样式在不同容器中一致

### Task 2: Popup 设置表单布局优化
- **ID**: task-2
- **Description**: 优化设置页面表单布局（内联分组、textarea 自适应高度、range/checkbox 视觉增强、长文本换行处理），提升表单可读性和操作体验
- **File Scope**: `packages/browser-extension/src/popup/index.html`
- **Dependencies**: task-1
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 测试表单元素在不同内容长度下的布局表现
  - 验证 range 滑块和 checkbox 的交互状态
  - 确认长标签文本正确换行不溢出

### Task 3: Popup 联系人列表布局修复
- **ID**: task-3
- **Description**: 修复联系人列表的头像/姓名/操作按钮换行问题，添加长姓名截断，对齐记忆框布局，为可点击元素添加 pointer cursor
- **File Scope**: `packages/browser-extension/src/popup/index.html`, `packages/browser-extension/src/popup/popup.ts`
- **Dependencies**: None
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test popup --coverage --reporter=verbose`
- **Test Focus**:
  - 测试长姓名的截断和 tooltip 显示
  - 验证联系人卡片在窄屏下的响应式布局
  - 确认点击事件正确绑定到可交互元素

### Task 4: Popup 关于页面文本和链接优化
- **ID**: task-4
- **Description**: 为关于页面应用文本颜色 token，调整按钮间距，增强链接可识别性（下划线/颜色）
- **File Scope**: `packages/browser-extension/src/popup/index.html`
- **Dependencies**: None
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 验证文本颜色使用 CSS 变量而非硬编码
  - 测试链接的 hover/focus 状态视觉反馈
  - 确认按钮间距符合 4px 倍数规范

### Task 5: 悬浮面板样式整合
- **ID**: task-5
- **Description**: 整合悬浮面板的样式定义（消除 copilot.css 与 copilot-ui.ts 内联样式的冲突），统一状态间距和排版，建立清晰的样式优先级
- **File Scope**: `packages/browser-extension/src/ui/copilot-ui.ts`, `packages/browser-extension/styles/copilot.css`, `packages/browser-extension/manifest.json`
- **Dependencies**: None
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test copilot-ui --coverage --reporter=verbose`
- **Test Focus**:
  - 验证样式表加载顺序和优先级
  - 测试内联样式与外部样式的覆盖关系
  - 确认所有状态使用统一的间距 token

### Task 6: 悬浮面板状态视觉优化
- **ID**: task-6
- **Description**: 优化悬浮面板各状态（empty/loading/error/notice/privacy/candidates）的间距、排版和滚动条一致性，提升视觉层次感
- **File Scope**: `packages/browser-extension/src/ui/copilot-ui.ts`, `packages/browser-extension/styles/copilot.css`
- **Dependencies**: task-5
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test copilot-ui --coverage --reporter=verbose`
- **Test Focus**:
  - 测试各状态的渲染输出和样式类应用
  - 验证滚动条在不同内容长度下的表现
  - 确认状态切换时的视觉连续性

### Task 7: 思路卡片交互增强
- **ID**: task-7
- **Description**: 为思路卡片添加选中状态视觉反馈，限制最多 6 个卡片，实现空卡片删除确认，统一卡片样式系统
- **File Scope**: `packages/browser-extension/src/ui/thought-cards.ts`, `packages/browser-extension/src/ui/copilot-ui.ts`, `packages/browser-extension/styles/copilot.css`
- **Dependencies**: task-5
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test thought-cards --coverage --reporter=verbose`
- **Test Focus**:
  - 测试卡片选中/取消选中的状态切换
  - 验证最多 6 个卡片的限制逻辑
  - 测试空卡片删除的确认流程
  - 确认卡片样式在不同状态下的一致性

### Task 8: 悬浮面板键盘可访问性
- **ID**: task-8
- **Description**: 为悬浮面板的候选项和思路卡片添加 focus-visible 样式和键盘交互支持（Tab/Enter/Space），符合 WCAG 2.1 AA 标准
- **File Scope**: `packages/browser-extension/src/ui/copilot-ui.ts`, `packages/browser-extension/src/ui/thought-cards.ts`, `packages/browser-extension/styles/copilot.css`
- **Dependencies**: task-5
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 测试 Tab 键导航顺序的逻辑正确性
  - 验证 Enter/Space 键触发点击事件
  - 确认 focus-visible 样式仅在键盘导航时显示
  - 测试屏幕阅读器的 ARIA 属性支持

### Task 9: Popup 控件键盘可访问性
- **ID**: task-9
- **Description**: 为 popup 所有控件添加 focus-visible 样式，移除非可点击卡片的误导性 pointer cursor，确保键盘用户体验
- **File Scope**: `packages/browser-extension/src/popup/index.html`
- **Dependencies**: task-1
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 验证所有表单控件的键盘可操作性
  - 测试 focus-visible 样式与鼠标点击的区分
  - 确认 cursor 样式与元素交互性匹配

### Task 10: 深色模式支持
- **ID**: task-10
- **Description**: 基于 CSS 变量系统为 popup 和悬浮面板添加深色模式支持，使用 `prefers-color-scheme` 媒体查询自动切换，确保所有颜色 token 适配深色主题
- **File Scope**: `packages/browser-extension/src/popup/index.html`, `packages/browser-extension/src/ui/copilot-ui.ts`, `packages/browser-extension/styles/copilot.css`
- **Dependencies**: task-1, task-5
- **Test Command**: `pnpm --filter @social-copilot/browser-extension test --coverage --reporter=verbose`
- **Test Focus**:
  - 测试深色模式下所有颜色变量的正确应用
  - 验证 `prefers-color-scheme: dark` 媒体查询生效
  - 确认深色模式下的对比度符合 WCAG AA 标准（4.5:1）
  - 测试深浅模式切换时的视觉连续性

## Acceptance Criteria
- [ ] Popup 所有交互控件具有一致的 hover/active/focus-visible 状态反馈
- [ ] 设置表单布局合理，长文本正确换行，range/checkbox 视觉清晰
- [ ] 联系人列表支持长姓名截断，布局在窄屏下不错乱
- [ ] 关于页面使用颜色 token，链接具有明确的视觉提示
- [ ] 悬浮面板样式系统统一，无内联与外部样式冲突
- [ ] 悬浮面板各状态（loading/error/empty/candidates）视觉层次清晰
- [ ] 思路卡片支持选中状态、最多 6 个限制、空卡片删除确认
- [ ] 所有交互元素支持键盘导航（Tab/Enter/Space），focus-visible 样式完整
- [ ] 深色模式在 popup 和悬浮面板中完整实现，颜色对比度符合 WCAG AA 标准
- [ ] 所有单元测试通过
- [ ] 代码覆盖率 ≥90%

## Technical Notes
- **样式架构**: Popup 使用 `index.html` 内嵌 `<style>` + CSS 变量；悬浮面板使用 `copilot.css` 外部样式表 + 最小化内联样式
- **设计 token**: 所有颜色、间距、圆角应使用 CSS 变量定义在 `:root` 中，深色模式通过 `@media (prefers-color-scheme: dark)` 覆盖
- **可访问性**: 遵循 WCAG 2.1 AA 标准，确保颜色对比度 ≥4.5:1，所有交互元素可键盘操作，focus-visible 样式明确
- **测试策略**: 使用 Vitest + jsdom 进行 DOM 测试，覆盖样式类应用、事件绑定、状态切换逻辑
- **浏览器兼容性**: 目标浏览器为 Chrome/Edge 最新版，使用 `-webkit-` 前缀处理滚动条样式
- **性能约束**: 避免复杂的 CSS 选择器和过度的 DOM 操作，悬浮面板渲染时间应 <16ms
- **向后兼容**: 保持现有 API 和事件接口不变，仅修改样式和交互细节
