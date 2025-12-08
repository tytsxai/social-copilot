import type { Message, ContactProfile, LLMProvider } from '../types';

/**
 * 画像更新器 - 从对话中自动提取并更新联系人画像
 */
export class ProfileUpdater {
  private llm: LLMProvider;
  private updateThreshold: number;

  constructor(llm: LLMProvider, updateThreshold = 20) {
    this.llm = llm;
    this.updateThreshold = updateThreshold;
  }

  /**
   * 判断是否需要更新画像
   */
  shouldUpdate(messageCount: number, lastUpdateCount: number): boolean {
    return messageCount - lastUpdateCount >= this.updateThreshold;
  }

  /**
   * 从最近对话中提取画像信息
   */
  async extractProfileUpdates(
    messages: Message[],
    existingProfile: ContactProfile
  ): Promise<Partial<ContactProfile>> {
    try {
      const response = await this.llm.generateReply({
        purpose: 'profile',
        context: {
          contactKey: existingProfile.key,
          recentMessages: messages,
          currentMessage: messages[messages.length - 1],
        },
        profile: existingProfile,
        memorySummary: this.buildExtractionPrompt(existingProfile),
        styles: ['rational'],
        language: 'zh',
      });

      // 解析 LLM 返回的画像更新
      const content = response.candidates[0]?.text || '';
      return this.parseProfileUpdates(content, existingProfile);
    } catch (error) {
      console.error('[ProfileUpdater] Failed to extract profile:', error);
      return {};
    }
  }

  private buildExtractionPrompt(profile: ContactProfile): string {
    const interests = profile.interests.join(', ') || '未知';
    const relationship = profile.relationshipType || '未知';
    const comms = profile.communicationStyle
      ? JSON.stringify(profile.communicationStyle)
      : '未知';
    const location = profile.basicInfo?.location || '未知';

    return `现有画像概要：
- 兴趣：${interests}
- 关系：${relationship}
- 沟通偏好：${comms}
- 地区：${location}
- 备注：${profile.notes || '无'}
请基于对话只补充有证据的新信息。`;
  }

  private parseProfileUpdates(
    content: string,
    existing: ContactProfile
  ): Partial<ContactProfile> {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return {};

      const parsed = JSON.parse(jsonMatch[0]);
      const updates: Partial<ContactProfile> = {};

      // 合并兴趣（去重）
      if (Array.isArray(parsed.interests) && parsed.interests.length > 0) {
        const newInterests = [...new Set([...existing.interests, ...parsed.interests])];
        if (newInterests.length > existing.interests.length) {
          updates.interests = newInterests;
        }
      }

      // 更新沟通风格
      if (parsed.communicationStyle) {
        updates.communicationStyle = {
          ...existing.communicationStyle,
          ...parsed.communicationStyle,
        };
      }

      // 更新基本信息
      if (parsed.basicInfo) {
        updates.basicInfo = {
          ...existing.basicInfo,
          ...parsed.basicInfo,
        };
      }

      // 更新关系类型
      if (parsed.relationshipType && parsed.relationshipType !== existing.relationshipType) {
        updates.relationshipType = parsed.relationshipType;
      }

      // 追加备注
      if (parsed.notes && parsed.notes !== existing.notes) {
        const existingNotes = existing.notes || '';
        const stampedNote = `[${this.formatDate(new Date())}] ${parsed.notes}`;
        updates.notes = existingNotes
          ? `${existingNotes}\n${stampedNote}`
          : stampedNote;
      }

      return updates;
    } catch {
      return {};
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
