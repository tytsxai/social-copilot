import type { ConversationContext } from '../types/message';
import type { ContactProfile } from '../types/contact';
import type { LLMInput, ReplyStyle } from '../types/llm';
import type { ThoughtType } from '../types/thought';
import { THOUGHT_CARDS } from '../types/thought';

/**
 * 思路感知的 Prompt 构建器
 * 将选中的思路方向融入 LLM 提示词
 */
export class ThoughtAwarePromptBuilder {
  /**
   * 构建包含思路方向的 LLM 输入
   */
  buildInput(
    context: ConversationContext,
    profile: ContactProfile | undefined,
    styles: ReplyStyle[],
    selectedThought?: ThoughtType,
    language: LLMInput['language'] = 'zh'
  ): LLMInput {
    const input: LLMInput = {
      context,
      profile,
      styles,
      language,
    };

    if (selectedThought) {
      input.thoughtDirection = selectedThought;
      input.thoughtHint = this.getThoughtPromptSegment(selectedThought);
    }

    return input;
  }

  /**
   * 获取思路相关的系统提示词片段
   */
  getThoughtPromptSegment(thought: ThoughtType): string {
    const card = THOUGHT_CARDS[thought];
    return card?.promptHint ?? '';
  }
}
