import type { ConversationContext } from '../types';
import type { ThoughtType, ThoughtCard, ThoughtAnalysisResult } from '../types';
import { THOUGHT_CARDS } from '../types';

/**
 * ThoughtAnalyzer 可配置项
 */
export interface ThoughtAnalyzerConfig {
  keywords: Record<string, string[]>;
  weights: Record<string, number>;
  defaultOrder: ThoughtType[];
}

export type ThoughtAnalyzerUserConfig = Partial<{
  keywords: Partial<ThoughtAnalyzerConfig['keywords']>;
  weights: Partial<ThoughtAnalyzerConfig['weights']>;
  defaultOrder: ThoughtAnalyzerConfig['defaultOrder'];
}>;

export const DEFAULT_CONFIG: ThoughtAnalyzerConfig = {
  keywords: {
    negative: ['难过', '伤心', '烦', '累', '压力', '焦虑', '担心', 'sad', 'upset', 'tired', 'stressed', '郁闷', '失望', '沮丧'],
    question: ['怎么', '如何', '为什么', '能不能', '可以吗', '?', '？', 'how', 'why', 'what', 'can you', '帮我', '请问', '求助'],
    playful: ['哈哈', '笑死', '有趣', '好玩', 'lol', 'haha', 'funny', '😂', '🤣', '哈哈哈', '太逗了', '笑'],
  },
  weights: {
    neutralBase: 0.1,
    negative: 2,
    question: 2,
    playful: 2,
  },
  defaultOrder: ['neutral', 'empathy', 'solution', 'humor'],
};

/**
 * 思路分析器
 * 根据对话上下文分析并推荐合适的思路方向
 */
export class ThoughtAnalyzer {
  private readonly config: ThoughtAnalyzerConfig;

  constructor(config?: ThoughtAnalyzerUserConfig) {
    const userKeywords = this.sanitizeKeywords(config?.keywords);
    const mergedKeywords: ThoughtAnalyzerConfig['keywords'] = {
      ...DEFAULT_CONFIG.keywords,
      ...userKeywords,
    };
    const userWeights = this.sanitizeWeights(config?.weights);
    const userDefaultOrder = this.sanitizeDefaultOrder(config?.defaultOrder);
    this.config = {
      keywords: Object.fromEntries(
        Object.entries(mergedKeywords).map(([key, value]) => [key, [...value]])
      ) as ThoughtAnalyzerConfig['keywords'],
      weights: {
        ...DEFAULT_CONFIG.weights,
        ...userWeights,
      },
      defaultOrder: [...userDefaultOrder],
    };
  }

  /**
   * 分析对话上下文，返回推荐的思路类型
   */
  analyze(context: ConversationContext): ThoughtAnalysisResult {
    // 处理空上下文
    if (!context || !context.currentMessage) {
      return {
        recommended: this.config.defaultOrder,
        confidence: 0,
        reason: 'Empty context, using default order',
      };
    }

    const rawText = (context.currentMessage as { text?: unknown }).text;
    if (typeof rawText !== 'string') {
      return {
        recommended: this.config.defaultOrder,
        confidence: 0,
        reason: 'Invalid message text, using default order',
      };
    }

    const messageText = rawText.toLowerCase();
    const scores: Record<ThoughtType, number> = {
      empathy: 0,
      solution: 0,
      humor: 0,
      neutral: this.config.weights.neutralBase ?? 0.1, // 基础分数，确保 neutral 始终有一定权重
    };

    // 检测负面情绪关键词 -> 优先 empathy
    const negativeMatches = this.countKeywordMatches(messageText, this.config.keywords.negative ?? []);
    if (negativeMatches > 0) {
      scores.empathy += negativeMatches * (this.config.weights.negative ?? 2);
    }

    // 检测问题/求助关键词 -> 优先 solution
    const questionMatches = this.countKeywordMatches(messageText, this.config.keywords.question ?? []);
    if (questionMatches > 0) {
      scores.solution += questionMatches * (this.config.weights.question ?? 2);
    }

    // 检测轻松/幽默关键词 -> 优先 humor
    const playfulMatches = this.countKeywordMatches(messageText, this.config.keywords.playful ?? []);
    if (playfulMatches > 0) {
      scores.humor += playfulMatches * (this.config.weights.playful ?? 2);
    }

    // 按分数排序思路类型
    const sortedTypes = (Object.keys(scores) as ThoughtType[]).sort(
      (a, b) => scores[b] - scores[a]
    );

    // 计算置信度（基于最高分与其他分数的差距）
    const maxScore = scores[sortedTypes[0]];
    const totalWeightedMatches =
      negativeMatches * (this.config.weights.negative ?? 2) +
      questionMatches * (this.config.weights.question ?? 2) +
      playfulMatches * (this.config.weights.playful ?? 2);
    const confidence = totalWeightedMatches > 0 ? Math.min(maxScore / (totalWeightedMatches + 1), 1) : 0;

    // 生成推荐原因
    const reasons: string[] = [];
    if (negativeMatches > 0) reasons.push('negative sentiment detected');
    if (questionMatches > 0) reasons.push('question/help-seeking detected');
    if (playfulMatches > 0) reasons.push('playful tone detected');

    return {
      recommended: sortedTypes,
      confidence,
      reason: reasons.length > 0 ? reasons.join(', ') : 'No specific sentiment detected',
    };
  }

  /**
   * 获取所有可用的思路卡片
   */
  getAllCards(): ThoughtCard[] {
    return Object.values(THOUGHT_CARDS);
  }

  /**
   * 根据分析结果获取排序后的思路卡片
   */
  getRecommendedCards(result: ThoughtAnalysisResult): ThoughtCard[] {
    return result.recommended.map((type) => THOUGHT_CARDS[type]);
  }

  /**
   * 计算文本中关键词匹配数量
   */
  private countKeywordMatches(text: string, keywords: string[]): number {
    return keywords.reduce((count, keyword) => {
      return count + (text.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
  }

  private sanitizeKeywords(
    keywords?: ThoughtAnalyzerUserConfig['keywords']
  ): Record<string, string[]> {
    if (!keywords || typeof keywords !== 'object') return {};
    const sanitized: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(keywords)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private sanitizeWeights(
    weights?: ThoughtAnalyzerUserConfig['weights']
  ): Record<string, number> {
    if (!weights || typeof weights !== 'object') return {};
    const sanitized: Record<string, number> = {};
    for (const [key, value] of Object.entries(weights)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private sanitizeDefaultOrder(defaultOrder?: ThoughtAnalyzerUserConfig['defaultOrder']): ThoughtType[] {
    if (!Array.isArray(defaultOrder)) return DEFAULT_CONFIG.defaultOrder;
    const allowedTypes = new Set(Object.keys(THOUGHT_CARDS) as ThoughtType[]);
    const filtered = defaultOrder.filter((type): type is ThoughtType => allowedTypes.has(type));
    return filtered.length > 0 ? filtered : DEFAULT_CONFIG.defaultOrder;
  }
}
