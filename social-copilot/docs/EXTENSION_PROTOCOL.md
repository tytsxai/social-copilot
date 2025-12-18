# Extension Protocol（内部消息协议）

> 本文档描述 Content Script / Popup 与 Background Service Worker 之间通过 `chrome.runtime.sendMessage` 交互的内部协议。
>
> 目标：让维护者不读源码也能理解“有哪些消息、传什么、回什么、失败时是什么样”。

## 1. 约定

- 请求统一形态：`{ type: string, ... }`
- 成功响应通常返回业务 payload；失败有两种形式：
  1. **业务可预期失败**：返回 `{ error: string }`（例如未配置 API Key、未确认隐私）
  2. **运行时异常**：Background 捕获并返回 `{ error: error.message }`

注意：`GENERATE_REPLY` 等接口返回的 `error` 是给用户看的提示语，不应作为程序控制流依赖。

## 2. 诊断与可恢复性

- Background 维护一个 ring buffer 诊断事件队列（用于导出/排障）
- 当 IndexedDB 初始化/迁移失败时，扩展仍需要能：
  - `GET_STATUS` 告知错误原因
  - `GET_DIAGNOSTICS` 导出诊断
  - `CLEAR_DATA` 自助清理并重建数据库

因此以上接口在 DB 不可用时也允许调用。

## 3. 消息列表

### 3.1 生成建议

**`GENERATE_REPLY`**

- Request:
  - `payload.contactKey: ContactKey`
  - `payload.messages: Message[]`（Content Script 抽取的最近消息，含当前消息）
  - `payload.currentMessage: Message`
  - `payload.thoughtDirection?: ThoughtType`
- Response（成功）:
  - `candidates: { text: string; style: ReplyStyle }[]`
  - `provider: string`
  - `model: string`
  - `latency: number`
  - `usingFallback: boolean`
- Response（失败）:
  - `{ error: string }`

失败场景：
- 未配置 API Key
- 未确认隐私告知（首次使用）
- 模型请求超时、429、5xx
- AI 返回内容无法解析为预期 JSON（会提示重试）

### 3.2 思路分析

**`ANALYZE_THOUGHT`**

- Request:
  - `payload.context: ConversationContext`
- Response:
  - `{ result: ThoughtAnalysisResult; cards: ThoughtCard[] }`

说明：思路分析是本地同步逻辑，不调用网络。

### 3.3 配置与状态

**`SET_CONFIG`**

- Request:
  - `config: Config`（Popup 汇总的设置项）
- Response:
  - `{ success: true }` 或 `{ error: string }`

**`GET_STATUS`**

- Request: 无
- Response:
  - `hasApiKey: boolean`（是否已初始化 LLMManager）
  - `activeProvider?: string`
  - `activeModel?: string`
  - `usingFallback: boolean`
  - `hasFallback: boolean`
  - `debugEnabled: boolean`
  - `privacyAcknowledged: boolean`
  - `autoTrigger: boolean`
  - `storeOk: boolean`
  - `storeError?: { name: string; message: string }`
  - `requestId: string`

**`ACK_PRIVACY`**

- Request: 无
- Response:
  - `{ success: true, privacyAcknowledged: true }`

### 3.4 画像/偏好/记忆

**`GET_PROFILE`**
- Request: `contactKey: ContactKey`
- Response: `{ profile?: ContactProfile | null }`

**`UPDATE_PROFILE`**
- Request: `contactKey: ContactKey`, `updates: Partial<ContactProfile>`
- Response: `{ success: true }` 或 `{ error: string }`

**`RECORD_STYLE_SELECTION`**
- Request: `contactKey: ContactKey`, `style: ReplyStyle`
- Response: `{ success: true }`

**`GET_STYLE_PREFERENCE`**
- Request: `contactKey: ContactKey`
- Response: `{ preference: StylePreference | null }`

**`RESET_STYLE_PREFERENCE`**
- Request: `contactKey: ContactKey`
- Response: `{ success: true }`

**`GET_CONTACT_MEMORY`**
- Request: `contactKey: ContactKey`
- Response: `{ memory: { summary: string; updatedAt: number } | null }`

**`CLEAR_CONTACT_MEMORY`**
- Request: `contactKey: ContactKey`
- Response: `{ success: true }`

### 3.5 联系人列表与数据清理

**`GET_CONTACTS`**
- Request: 无
- Response: `{ contacts: Array<{ displayName: string; app: string; messageCount: number; key: ContactKey; memorySummary?: string | null; memoryUpdatedAt?: number | null }> }`

**`CLEAR_CONTACT_DATA`**
- Request: `contactKey: ContactKey`
- Response: `{ success: true }`

**`CLEAR_DATA`**
- Request: 无
- Response:
  - 成功：`{ success: true }`
  - 失败：`{ success: false, error: string }`（常见：IndexedDB 删除被阻塞）

### 3.6 诊断与调试

**`SET_DEBUG_ENABLED`**
- Request: `enabled: boolean`
- Response: `{ success: true, debugEnabled: boolean }`

**`GET_DIAGNOSTICS`**
- Request: 无
- Response:
  - `version: string`
  - `debugEnabled: boolean`
  - `maxEvents: number`
  - `eventCount: number`
  - `events: DiagnosticEvent[]`

**`CLEAR_DIAGNOSTICS`**
- Request: 无
- Response: `{ success: true }`

### 3.7 适配器健康上报

**`REPORT_ADAPTER_HEALTH`**
- Request:
  - `payload.ok: boolean`
  - `payload.app/host/pathname/...`（仅包含摘要信息，不包含原文消息）
- Response: `{ success: true }`

