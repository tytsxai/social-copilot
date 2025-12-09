import type { ConversationContext } from '../types';
import type { ThoughtType, ThoughtCard, ThoughtAnalysisResult } from '../types';
import { THOUGHT_CARDS } from '../types';

/**
 * 情感关键词映射
 */
const SENTIMENT_KEYWORDS = {
  negative: ['难过', '伤心', '烦', '累', '压力', '焦虑', '担心', 'sad', 'upset', 'tired', 'stressed', '郁闷', '失望', '沮丧'],
  question: ['怎么', '如何', '为什么', '能不能', '可以吗', '?', '？', 'how', 'why', 'what', 'can you', '帮我', '请问', '求助'],
  playful: ['哈哈', '笑死', '有趣', '好玩', 'lol', 'haha', 'funny', '😂', '🤣', '哈哈哈', '太逗了', '笑'],
};

/**
 * 默认思路类型顺序
 */
const DEFAULT_THOUGHT_ORDER: ThoughtType[] = ['neutral', 'empathy', 'solution', 'humor'];

/**
 * 思路分析器
 * 根据对话上下文分析并推荐合适的思路方向
 */
export class ThoughtAnalyzer {
  /**
   * 分析对话上下文，返回推荐的思路类型
   */
  analyze(context: ConversationContext): ThoughtAnalysisResult {
    // 处理空上下文
    if (!context || !context.currentMessage) {
      return {
        recommended: DEFAULT_THOUGHT_ORDER,
        confidence: 0,
        reason: 'Empty context, using default order',
      };
    }

    const messageText = context.currentMessage.text.toLowerCase();
    const scores: Record<ThoughtType, number> = {
      empathy: 0,
      solution: 0,
      humor: 0,
      neutral: 0.1, // 基础分数，确保 neutral 始终有一定权重
    };

    // 检测负面情绪关键词 -> 优先 empathy
    const negativeMatches = this.countKeywordMatches(messageText, SENTIMENT_KEYWORDS.negative);
    if (negativeMatches > 0) {
      scores.empathy += negativeMatches * 2;
    }

    // 检测问题/求助关键词 -> 优先 solution
    const questionMatches = this.countKeywordMatches(messageText, SENTIMENT_KEYWORDS.question);
    if (questionMatches > 0) {
      scores.solution += questionMatches * 2;
    }

    // 检测轻松/幽默关键词 -> 优先 humor
    const playfulMatches = this.countKeywordMatches(messageText, SENTIMENT_KEYWORDS.playful);
    if (playfulMatches > 0) {
      scores.humor += playfulMatches * 2;
    }

    // 按分数排序思路类型
    const sortedTypes = (Object.keys(scores) as ThoughtType[]).sort(
      (a, b) => scores[b] - scores[a]
    );

    // 计算置信度（基于最高分与其他分数的差距）
    const maxScore = scores[sortedTypes[0]];
    const totalMatches = negativeMatches + questionMatches + playfulMatches;
    const confidence = totalMatches > 0 ? Math.min(maxScore / (totalMatches * 2 + 1), 1) : 0;

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
}
