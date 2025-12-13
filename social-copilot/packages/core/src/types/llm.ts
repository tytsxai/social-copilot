import type { ContactProfile } from './contact';
import type { ConversationContext } from './message';
import type { ThoughtType } from './thought';

/**
 * 回复风格
 */
export type ReplyStyle = 'humorous' | 'caring' | 'rational' | 'casual' | 'formal';

/**
 * 调用任务类型
 */
export type LLMTask = 'reply' | 'profile_extraction' | 'memory_extraction';

/**
 * LLM 输入
 */
export interface LLMInput {
  /** 对话上下文 */
  context: ConversationContext;
  /** 联系人画像 */
  profile?: ContactProfile;
  /** 记忆摘要 */
  memorySummary?: string;
  /** 期望的回复风格 */
  styles: ReplyStyle[];
  /** 语言偏好 */
  language: 'zh' | 'en' | 'auto';
  /** 最大回复长度 */
  maxLength?: number;
  /** 任务类型（默认 reply） */
  task?: LLMTask;
  /** 选中的思路方向（可选） */
  thoughtDirection?: ThoughtType;
  /** 思路提示语 */
  thoughtHint?: string;
}

/**
 * 单个候选回复
 */
export interface ReplyCandidate {
  /** 回复文本 */
  text: string;
  /** 风格标签 */
  style: ReplyStyle;
  /** 置信度 0-1 */
  confidence?: number;
}

/**
 * LLM 输出
 */
export interface LLMOutput {
  /** 候选回复列表 */
  candidates: ReplyCandidate[];
  /** 模型名称 */
  model: string;
  /** 耗时(ms) */
  latency: number;
  /** 原始响应（调试用） */
  raw?: unknown;
}

/**
 * LLM Provider 接口
 */
export interface LLMProvider {
  readonly name: string;
  generateReply(input: LLMInput): Promise<LLMOutput>;
}
