# 故障排查手册

本文档提供 Social Copilot 常见问题的诊断和解决方案。

## 目录

- [扩展无法加载](#扩展无法加载)
- [平台适配器问题](#平台适配器问题)
- [LLM 调用失败](#llm-调用失败)
- [存储相关问题](#存储相关问题)
- [性能问题](#性能问题)
- [调试工具](#调试工具)

---

## 扩展无法加载

### 症状：扩展图标灰色或无响应

**可能原因**：
1. Service Worker 崩溃
2. 权限不足
3. 内容脚本注入失败

**诊断步骤**：
```
1. 打开 chrome://extensions/
2. 找到 Social Copilot，点击"错误"查看日志
3. 点击"Service Worker"链接检查后台脚本状态
```

**解决方案**：
- 点击扩展的刷新按钮重新加载
- 检查是否有冲突的扩展
- 确认目标网站在 manifest.json 的 host_permissions 中

### 症状：Content Script 未注入

**诊断**：
```javascript
// 在目标页面控制台执行
console.log(window.__SOCIAL_COPILOT_INJECTED__);
// 应返回 true，否则表示未注入
```

**解决方案**：
- 刷新页面
- 检查 CSP 策略是否阻止脚本注入
- 确认 URL 匹配 manifest 中的 content_scripts.matches

---

## 平台适配器问题

### 症状：无法识别当前平台

**诊断**：
```javascript
// 控制台执行
import { detectAdapter } from '@social-copilot/browser-extension/adapters';
const adapter = detectAdapter();
console.log('当前适配器:', adapter?.platform);
```

**常见原因**：
| 平台 | 检查项 |
|------|--------|
| Telegram | URL 是否为 web.telegram.org |
| WhatsApp | URL 是否为 web.whatsapp.com |
| Slack | URL 是否为 app.slack.com |

### 症状：消息提取为空

**诊断**：
```javascript
const adapter = detectAdapter();
const messages = adapter?.extractMessages(10);
console.log('提取的消息:', messages);
```

**可能原因**：
1. 选择器过时（平台 UI 更新）
2. 页面未完全加载
3. 当前不在聊天界面

**解决方案**：
- 等待页面完全加载后重试
- 检查是否在正确的聊天窗口
- 更新扩展到最新版本

### 症状：输入框填充失败

**诊断**：
```javascript
const adapter = detectAdapter();
const input = adapter?.getInputElement();
console.log('输入框元素:', input);
const success = adapter?.fillInput('测试文本');
console.log('填充结果:', success);
```

**解决方案**：
- 确保输入框处于可编辑状态
- 检查是否有其他脚本拦截输入事件

---

## LLM 调用失败

### 症状：API error: 401

**原因**：API Key 无效或过期

**解决方案**：
1. 检查 API Key 格式是否正确
2. 确认 Key 未过期或被撤销
3. 验证 Key 对应的提供商是否正确

```typescript
// API Key 格式参考
DeepSeek: sk-xxx
OpenAI: sk-xxx
Claude: sk-ant-xxx
NVIDIA: nvapi-xxx
```

### 症状：API error: 429

**原因**：请求限流

**解决方案**：
- 等待一段时间后重试
- 检查账户配额
- 考虑配置备用提供商

### 症状：ReplyParseError

**原因**：LLM 返回格式不符合预期

**诊断**：
```typescript
// 启用调试模式查看原始响应
localStorage.setItem('social-copilot-debug', 'true');
```

**解决方案**：
- 系统会自动重试一次（追加格式提示）
- 如持续失败，考虑切换模型
- 检查 temperature 设置是否过高

### 症状：网络超时

**可能原因**：
1. 网络不稳定
2. API 服务不可用
3. 代理配置问题

**解决方案**：
- 检查网络连接
- 配置备用提供商实现自动故障转移
- 检查是否需要代理访问 API

---

## 存储相关问题

### 症状：Database blocked

**原因**：IndexedDB 被其他标签页占用

**解决方案**：
1. 关闭所有使用该扩展的标签页
2. 重新打开一个标签页
3. 如问题持续，重启浏览器

### 症状：数据丢失

**可能原因**：
1. 浏览器清除了站点数据
2. 数据库版本升级失败
3. 存储配额超限

**预防措施**：
```typescript
// 定期导出备份
const store = new IndexedDBStore();
await store.init();
const snapshot = await store.exportSnapshot();
// 保存 snapshot 到文件
```

### 症状：Unsupported schema

**原因**：数据库版本不兼容（通常是降级安装）

**解决方案**：
1. 更新到最新版本扩展
2. 如需降级，先导出数据，清除数据库后重新导入

---

## 性能问题

### 症状：页面卡顿

**诊断**：
1. 打开 DevTools Performance 面板
2. 录制操作过程
3. 检查是否有长任务

**常见原因**：
- MutationObserver 回调过于频繁
- 消息提取遍历过多 DOM 节点
- IndexedDB 事务阻塞

**解决方案**：
- 减少消息提取数量
- 检查是否有内存泄漏
- 清理过多的历史消息

### 症状：LLM 响应慢

**优化建议**：
1. 启用缓存（默认开启）
2. 减少上下文消息数量
3. 使用更快的模型

```typescript
const manager = new LLMManager({
  primary: { provider: 'deepseek', apiKey: '...' },
  cache: {
    enabled: true,
    size: 100,
    ttl: 300000, // 5分钟
  },
});
```

---

## 调试工具

### 启用调试模式

```javascript
// 控制台执行
localStorage.setItem('social-copilot-debug', 'true');
// 刷新页面后生效
```

### 查看缓存统计

```typescript
const stats = manager.getCacheStats();
console.log(`缓存命中率: ${(stats.hitRate * 100).toFixed(1)}%`);
```

### 检查适配器状态

```javascript
const adapter = detectAdapter();
if (adapter?.getRuntimeInfo) {
  console.log('运行时信息:', adapter.getRuntimeInfo());
}
```

### 导出诊断信息

```typescript
async function exportDiagnostics() {
  const store = new IndexedDBStore();
  await store.init();

  return {
    profiles: (await store.getAllProfiles()).length,
    stylePrefs: (await store.getAllStylePreferences()).length,
    memories: (await store.getAllContactMemorySummaries()).length,
    adapter: detectAdapter()?.platform,
    timestamp: Date.now(),
  };
}
```

---

**相关文档**：
- [开发指南](./DEVELOPMENT.md)
- [API 参考](./API.md)
- [运维手册](./RUNBOOK.md)
