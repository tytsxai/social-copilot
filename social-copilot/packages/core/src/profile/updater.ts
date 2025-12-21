import type { Message, ContactProfile, LLMProvider } from '../types';
import { parseJsonObjectFromText } from '../utils/json';
import { safeAssignPlain } from '../utils/safe-merge';
import type { LLMInput } from '../types';
import { DEFAULT_INPUT_BUDGETS, normalizeAndClampLLMInput } from '../llm/input-budgets';

export type ProfileUpdaterErrorCode =
  | 'INVALID_EXISTING_PROFILE'
  | 'LLM_REQUEST_FAILED';

export class ProfileUpdaterError extends Error {
  readonly code: ProfileUpdaterErrorCode;
  readonly cause?: unknown;

  constructor(code: ProfileUpdaterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ProfileUpdaterError';
    this.code = code;
    this.cause = options?.cause;
  }
}

const MAX_INTERESTS = 20;
const MAX_INTEREST_LENGTH = 64;

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
    existingProfile: ContactProfile,
    language: LLMInput['language'] = 'auto'
  ): Promise<Partial<ContactProfile>> {
    if (messages.length === 0) {
      return {};
    }

    try {
      const validatedProfile = this.validateExistingProfile(existingProfile);
      const memorySummary = this.buildExtractionPrompt(validatedProfile);

      const rawInput: LLMInput = {
        task: 'profile_extraction',
        context: {
          contactKey: validatedProfile.key,
          recentMessages: messages,
          currentMessage: messages[messages.length - 1],
        },
        profile: validatedProfile,
        memorySummary,
        styles: ['rational'],
        language,
      };

      const response = await this.llm.generateReply(
        normalizeAndClampLLMInput(rawInput, DEFAULT_INPUT_BUDGETS)
      );

      // 解析 LLM 返回的画像更新
      const content = response.candidates[0]?.text || '';
      return this.parseProfileUpdates(content, validatedProfile);
    } catch (error) {
      if (error instanceof ProfileUpdaterError) {
        throw error;
      }
      throw new ProfileUpdaterError(
        'LLM_REQUEST_FAILED',
        '[ProfileUpdater] Failed to extract profile updates',
        { cause: error }
      );
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

  private validateExistingProfile(profile: unknown): ContactProfile {
    const isPlainObject = (value: unknown): value is Record<string, unknown> => {
      if (typeof value !== 'object' || value === null) return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    };

    if (!isPlainObject(profile)) {
      throw new ProfileUpdaterError('INVALID_EXISTING_PROFILE', 'existingProfile must be a plain object');
    }

    const key = (profile as Record<string, unknown>).key;
    if (!isPlainObject(key)) {
      throw new ProfileUpdaterError('INVALID_EXISTING_PROFILE', 'existingProfile.key must be an object');
    }

    const platform = key.platform;
    const app = key.app;
    const conversationId = key.conversationId;
    const peerId = key.peerId;
    const isGroup = key.isGroup;

    if (
      typeof platform !== 'string' ||
      typeof app !== 'string' ||
      typeof conversationId !== 'string' ||
      typeof peerId !== 'string' ||
      typeof isGroup !== 'boolean'
    ) {
      throw new ProfileUpdaterError('INVALID_EXISTING_PROFILE', 'existingProfile.key has invalid fields');
    }

    const displayName = (profile as Record<string, unknown>).displayName;
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      throw new ProfileUpdaterError('INVALID_EXISTING_PROFILE', 'existingProfile.displayName must be a non-empty string');
    }

    const interests = (profile as Record<string, unknown>).interests;
    if (!Array.isArray(interests)) {
      throw new ProfileUpdaterError('INVALID_EXISTING_PROFILE', 'existingProfile.interests must be an array');
    }

    const sanitizedInterests = this.sanitizeInterests(interests);

    const contactProfile = profile as ContactProfile;
    return {
      ...contactProfile,
      displayName: displayName.trim(),
      interests: sanitizedInterests,
    };
  }

  private sanitizeInterests(interests: unknown[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of interests) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_INTEREST_LENGTH) continue;
      if (seen.has(trimmed)) continue;
      out.push(trimmed);
      seen.add(trimmed);
      if (out.length >= MAX_INTERESTS) break;
    }
    return out;
  }

  private mergeInterests(existing: string[], incoming: string[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const item of existing) {
      if (seen.has(item)) continue;
      merged.push(item);
      seen.add(item);
    }
    for (const item of incoming) {
      if (seen.has(item)) continue;
      merged.push(item);
      seen.add(item);
    }
    if (merged.length <= MAX_INTERESTS) return merged;
    // Keep the most recent items to make room for new interests.
    return merged.slice(-MAX_INTERESTS);
  }

  private parseProfileUpdates(
    content: string,
    existing: ContactProfile
  ): Partial<ContactProfile> {
    try {
      const parsed = parseJsonObjectFromText(content);
      const updates: Partial<ContactProfile> = {};

      const isPlainObject = (value: unknown): value is Record<string, unknown> => {
        if (typeof value !== 'object' || value === null) return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
      };

      const sanitizeCommunicationStyle = (value: unknown): Record<string, unknown> | null => {
        if (!isPlainObject(value)) return null;
        const out: Record<string, unknown> = {};
        if (typeof value.prefersShortMessages === 'boolean') out.prefersShortMessages = value.prefersShortMessages;
        if (typeof value.usesEmoji === 'boolean') out.usesEmoji = value.usesEmoji;
        if (value.formalityLevel === 'casual' || value.formalityLevel === 'neutral' || value.formalityLevel === 'formal') {
          out.formalityLevel = value.formalityLevel;
        }
        return out;
      };

      const sanitizeBasicInfo = (value: unknown): Record<string, unknown> | null => {
        if (!isPlainObject(value)) return null;
        const out: Record<string, unknown> = {};
        if (typeof value.ageRange === 'string') out.ageRange = value.ageRange;
        if (typeof value.occupation === 'string') out.occupation = value.occupation;
        if (typeof value.location === 'string') out.location = value.location;
        return out;
      };

      // 合并兴趣（去重 + 净化 + 限制长度）
      if (Array.isArray(parsed.interests) && parsed.interests.length > 0) {
        const sanitizedIncoming = this.sanitizeInterests(parsed.interests);
        if (sanitizedIncoming.length > 0) {
          const merged = this.mergeInterests(existing.interests, sanitizedIncoming);
          const changed =
            merged.length !== existing.interests.length ||
            merged.some((value, idx) => value !== existing.interests[idx]);
          if (changed) {
            updates.interests = merged;
          }
        }
      }

      // 更新沟通风格
      if (parsed.communicationStyle) {
        const sanitized = sanitizeCommunicationStyle(parsed.communicationStyle);
        if (sanitized) {
          updates.communicationStyle = safeAssignPlain(
            { ...(existing.communicationStyle || {}) },
            sanitized
          );
        }
      }

      // 更新基本信息
      if (parsed.basicInfo) {
        const sanitized = sanitizeBasicInfo(parsed.basicInfo);
        if (sanitized) {
          updates.basicInfo = safeAssignPlain(
            { ...(existing.basicInfo || {}) },
            sanitized
          );
        }
      }

      // 更新关系类型
      if (typeof parsed.relationshipType === 'string' && parsed.relationshipType !== existing.relationshipType) {
        const allowed = new Set(['friend', 'colleague', 'family', 'acquaintance', 'romantic', 'other']);
        if (allowed.has(parsed.relationshipType)) {
          updates.relationshipType = parsed.relationshipType as ContactProfile['relationshipType'];
        }
      }

      // 追加备注
      if (parsed.notes && parsed.notes !== existing.notes) {
        const existingNotes = existing.notes || '';
        const stampedNote = `[${this.formatDate(Date.now())}] ${parsed.notes}`;
        updates.notes = this.mergeNotes(existingNotes, stampedNote);
      }

      return updates;
    } catch {
      return {};
    }
  }

  private formatDate(date: number | Date): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  /**
   * 合并备注并限制最大长度，避免无限膨胀
   */
  private mergeNotes(existing: string, incoming: string, maxLength = 2048): string {
    const parts = existing ? existing.split('\n') : [];
    if (!parts.includes(incoming)) {
      parts.push(incoming);
    }
    // 只保留末尾部分，保证总长度不超过上限
    let merged = parts.join('\n');
    while (merged.length > maxLength && parts.length > 1) {
      parts.shift();
      merged = parts.join('\n');
    }
    return merged.slice(-maxLength);
  }
}
