/**
 * 思路类型枚举
 */
export type ThoughtType = 'empathy' | 'solution' | 'humor' | 'neutral';

/**
 * 思路卡片数据
 */
export interface ThoughtCard {
  type: ThoughtType;
  label: string;
  description: string;
  icon: string;
  promptHint: string;
}

/**
 * 思路分析结果
 */
export interface ThoughtAnalysisResult {
  recommended: ThoughtType[];
  confidence: number;
  reason?: string;
}

/**
 * 预定义思路卡片数据
 */
export const THOUGHT_CARDS: Record<ThoughtType, ThoughtCard> = {
  empathy: {
    type: 'empathy',
    label: '共情关怀',
    description: '表达理解和支持',
    icon: '💗',
    promptHint: '以共情和关怀的语气回复，表达理解对方的感受，给予情感支持',
  },
  solution: {
    type: 'solution',
    label: '解决方案',
    description: '提供建议或帮助',
    icon: '💡',
    promptHint: '以解决问题为导向，提供实用的建议或具体的帮助方案',
  },
  humor: {
    type: 'humor',
    label: '幽默化解',
    description: '轻松有趣的回应',
    icon: '😄',
    promptHint: '以幽默轻松的方式回复，活跃气氛，让对话更有趣',
  },
  neutral: {
    type: 'neutral',
    label: '中性回应',
    description: '平和自然的回复',
    icon: '💬',
    promptHint: '以平和自然的语气回复，不带特定情感倾向',
  },
};
