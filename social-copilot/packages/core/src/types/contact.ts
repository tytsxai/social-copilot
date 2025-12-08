/**
 * 联系人唯一标识
 */
export interface ContactKey {
  /** 平台类型 */
  platform: 'web' | 'windows' | 'mac' | 'android' | 'ios';
  /** 应用标识 */
  app: 'telegram' | 'whatsapp' | 'slack' | 'discord' | 'wechat' | 'qq' | 'other';
  /** 本端账号ID（可选） */
  accountId?: string;
  /** 会话ID */
  conversationId: string;
  /** 对方标识（用户ID或昵称） */
  peerId: string;
  /** 是否群聊 */
  isGroup: boolean;
}

/**
 * 联系人画像
 */
export interface ContactProfile {
  key: ContactKey;
  /** 显示名称 */
  displayName: string;
  /** 基本信息 */
  basicInfo?: {
    ageRange?: string;
    occupation?: string;
    location?: string;
  };
  /** 兴趣偏好 */
  interests: string[];
  /** 沟通偏好 */
  communicationStyle?: {
    prefersShortMessages?: boolean;
    usesEmoji?: boolean;
    formalityLevel?: 'casual' | 'neutral' | 'formal';
  };
  /** 关系类型 */
  relationshipType?: 'friend' | 'colleague' | 'family' | 'acquaintance' | 'romantic' | 'other';
  /** 备注 */
  notes?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 生成 ContactKey 的字符串形式，用于存储索引
 */
export function contactKeyToString(key: ContactKey): string {
  const accountPart = key.accountId ? `:${key.accountId}` : '';
  const groupPart = key.isGroup ? ':group' : ':dm';
  return `${key.platform}:${key.app}${accountPart}:${key.conversationId}:${key.peerId}${groupPart}`;
}
