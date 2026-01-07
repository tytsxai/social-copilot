# 思路分析系统文档

本文档介绍 Social Copilot 的思路分析系统，用于根据对话上下文推荐合适的回复思路。

## 目录

- [系统概述](#系统概述)
- [思路类型](#思路类型)
- [关键词配置](#关键词配置)
- [分析器工作流程](#分析器工作流程)
- [扩展指南](#扩展指南)

## 系统概述

```
┌─────────────────────────────────────────┐
│           ConversationContext           │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│           ThoughtAnalyzer               │
│  ┌─────────────────────────────────┐    │
│  │  关键词匹配 → 分数计算 → 排序  │    │
│  └─────────────────────────────────┘    │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│         ThoughtAnalysisResult           │
│  { recommended, confidence, reason }    │
└─────────────────────────────────────────┘
```

**核心文件**: `packages/core/src/thought/analyzer.ts`

## 思路类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `empathy` | 共情型 | 对方表达负面情绪时 |
| `solution` | 解决型 | 对方寻求帮助或提问时 |
| `humor` | 幽默型 | 轻松愉快的对话氛围 |
| `neutral` | 中性型 | 默认/无明显情感倾向 |

## 关键词配置

```typescript
// analyzer.ts:20-33
const DEFAULT_CONFIG = {
  keywords: {
    negative: ['难过', '伤心', '烦', '累', '压力', 'sad', 'upset', 'tired'],
    question: ['怎么', '如何', '为什么', '?', '？', 'how', 'why', '帮我'],
    playful: ['哈哈', '笑死', '有趣', 'lol', 'haha', '😂'],
  },
  weights: {
    neutralBase: 0.1,
    negative: 2,
    question: 2,
    playful: 2,
  },
  defaultOrder: ['neutral', 'empathy', 'solution', 'humor'],
};
```

## 分析器工作流程

1. 提取消息文本并转小写
2. 统计各类关键词匹配数
3. 计算各思路类型得分
4. 按得分排序返回推荐列表

```typescript
const analyzer = new ThoughtAnalyzer();
const result = analyzer.analyze(context);
// { recommended: ['empathy', 'neutral', ...], confidence: 0.8 }
```

## 算法详解

### 关键词匹配流程

分析器采用基于关键词的情感检测算法，流程如下：

```
输入消息 → 文本预处理(小写化) → 关键词匹配 → 分数计算 → 排序 → 输出推荐
```

**匹配逻辑**（`countKeywordMatches` 方法）：
```typescript
// 遍历关键词列表，统计匹配数量
private countKeywordMatches(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => {
    return count + (text.includes(keyword.toLowerCase()) ? 1 : 0);
  }, 0);
}
```

### 分数计算公式

每种思路类型的分数计算：

| 思路类型 | 计算公式 |
|----------|----------|
| `empathy` | `negativeMatches × weights.negative` |
| `solution` | `questionMatches × weights.question` |
| `humor` | `playfulMatches × weights.playful` |
| `neutral` | `weights.neutralBase`（固定基础分） |

**示例**：消息 "我好累啊，怎么办？" 的分数计算：
- `negativeMatches = 1`（匹配 "累"）
- `questionMatches = 1`（匹配 "怎么"）
- 分数：`empathy = 1×2 = 2`, `solution = 1×2 = 2`, `humor = 0`, `neutral = 0.1`

### 置信度计算

置信度反映推荐结果的可靠程度：

```typescript
const totalWeightedMatches =
  negativeMatches × weights.negative +
  questionMatches × weights.question +
  playfulMatches × weights.playful;

const confidence = totalWeightedMatches > 0
  ? Math.min(maxScore / (totalWeightedMatches + 1), 1)
  : 0;
```

- 置信度范围：`[0, 1]`
- 无匹配时置信度为 `0`
- 单一情感明显时置信度接近 `1`

### 排序逻辑

按分数降序排列所有思路类型：

```typescript
const sortedTypes = (Object.keys(scores) as ThoughtType[]).sort(
  (a, b) => scores[b] - scores[a]
);
```

## 配置自定义

### 完整配置结构

```typescript
interface ThoughtAnalyzerConfig {
  keywords: {
    negative: string[];  // 负面情绪关键词
    question: string[];  // 问题/求助关键词
    playful: string[];   // 轻松/幽默关键词
  };
  weights: {
    neutralBase: number; // neutral 基础分（默认 0.1）
    negative: number;    // 负面关键词权重（默认 2）
    question: number;    // 问题关键词权重（默认 2）
    playful: number;     // 幽默关键词权重（默认 2）
  };
  defaultOrder: ThoughtType[]; // 无匹配时的默认顺序
}
```

### 自定义示例

```typescript
import { ThoughtAnalyzer } from '@social-copilot/core';

// 场景1: 添加自定义关键词
const analyzer1 = new ThoughtAnalyzer({
  keywords: {
    negative: ['郁闷', '心烦', '崩溃', '无语'],
    question: ['求推荐', '有没有', '谁知道'],
  },
});

// 场景2: 调整权重（更敏感地检测负面情绪）
const analyzer2 = new ThoughtAnalyzer({
  weights: {
    negative: 3,      // 提高负面情绪权重
    neutralBase: 0.2, // 提高 neutral 基础分
  },
});

// 场景3: 自定义默认顺序
const analyzer3 = new ThoughtAnalyzer({
  defaultOrder: ['solution', 'empathy', 'neutral', 'humor'],
});
```

## 与 LLM 集成

### ThoughtAwarePromptBuilder

`ThoughtAwarePromptBuilder` 用于构建带思路提示的 LLM 输入：

```typescript
import { ThoughtAwarePromptBuilder, ThoughtAnalyzer } from '@social-copilot/core';

const analyzer = new ThoughtAnalyzer();
const builder = new ThoughtAwarePromptBuilder();

// 1. 分析对话上下文
const result = analyzer.analyze(context);

// 2. 获取推荐的思路类型
const recommendedThought = result.recommended[0]; // 'empathy'

// 3. 构建 LLM 输入
const input = builder.buildInput(
  context,           // 对话上下文
  profile,           // 联系人画像
  ['casual'],        // 风格列表
  recommendedThought // 思路方向
);

// input 结构：
// {
//   context,
//   profile,
//   styles: ['casual'],
//   language: 'zh',
//   thoughtDirection: 'empathy',
//   thoughtHint: '请以共情、理解的方式回应...'
// }
```

### 思路提示注入

每种思路类型对应的 `promptHint`：

| 类型 | promptHint 示例 |
|------|-----------------|
| `empathy` | "请以共情、理解的方式回应，关注对方的情绪感受" |
| `solution` | "请提供实用的建议或解决方案，帮助对方解决问题" |
| `humor` | "请用轻松幽默的方式回应，活跃对话气氛" |
| `neutral` | "请以平和自然的方式回应" |

## 使用示例

### 基础用法

```typescript
import { ThoughtAnalyzer } from '@social-copilot/core';

const analyzer = new ThoughtAnalyzer();

// 分析消息
const result = analyzer.analyze({
  currentMessage: { text: '最近工作压力好大，感觉很累' },
  recentMessages: [],
});

console.log(result);
// {
//   recommended: ['empathy', 'solution', 'neutral', 'humor'],
//   confidence: 0.67,
//   reason: 'negative sentiment detected'
// }
```

### 获取思路卡片

```typescript
// 获取所有卡片
const allCards = analyzer.getAllCards();

// 获取推荐排序的卡片（用于 UI 展示）
const sortedCards = analyzer.getRecommendedCards(result);

// 卡片结构
// {
//   type: 'empathy',
//   label: '共情',
//   description: '理解对方的情绪',
//   icon: '💝',
//   promptHint: '...'
// }
```

### 完整工作流

```typescript
import {
  ThoughtAnalyzer,
  ThoughtAwarePromptBuilder,
  LLMManager
} from '@social-copilot/core';

async function generateReplyWithThought(context, profile) {
  // 1. 分析思路
  const analyzer = new ThoughtAnalyzer();
  const analysis = analyzer.analyze(context);

  // 2. 构建输入
  const builder = new ThoughtAwarePromptBuilder();
  const input = builder.buildInput(
    context,
    profile,
    ['casual'],
    analysis.recommended[0]
  );

  // 3. 调用 LLM
  const manager = new LLMManager({ /* config */ });
  const output = await manager.generateReply(input);

  return {
    reply: output.candidates[0],
    thought: analysis.recommended[0],
    confidence: analysis.confidence,
  };
}
```

---

**相关文档**:
- [LLM 集成](./LLM_INTEGRATION.md)
- [API 参考](./API.md)
