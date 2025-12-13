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
  const encode = (value: string) => encodeURIComponent(value);
  // v2: keep the storage key stable across display name changes by excluding peerId.
  const parts = [
    encode(key.platform),
    encode(key.app),
    encode(key.accountId ?? ''),
    encode(key.conversationId),
    key.isGroup ? 'group' : 'dm',
  ];
  return parts.join(':');
}

/**
 * v1（旧版，已转义）字符串形式：包含 peerId
 * 保留用于兼容读取与数据迁移
 */
export function contactKeyToStringV1(key: ContactKey): string {
  const encode = (value: string) => encodeURIComponent(value);
  const parts = [
    encode(key.platform),
    encode(key.app),
    encode(key.accountId ?? ''),
    encode(key.conversationId),
    encode(key.peerId),
    key.isGroup ? 'group' : 'dm',
  ];
  return parts.join(':');
}

/**
 * 旧版（未转义）字符串形式，保留用于兼容与数据迁移
 */
export function legacyContactKeyToString(key: ContactKey): string {
  const accountPart = key.accountId ? `:${key.accountId}` : '';
  const groupPart = key.isGroup ? ':group' : ':dm';
  return `${key.platform}:${key.app}${accountPart}:${key.conversationId}:${key.peerId}${groupPart}`;
}

function isGroupFlag(flag: string): flag is 'group' | 'dm' {
  return flag === 'group' || flag === 'dm';
}

/**
 * 将历史 contactKeyStr（v1/v0）规范化为当前版本（v2）
 * 用于迁移与数据兼容
 */
export function normalizeContactKeyStr(keyStr: string): string {
  const parts = keyStr.split(':');
  if (parts.length >= 5 && isGroupFlag(parts[parts.length - 1])) {
    // v2: platform:app:accountId:conversationId:(group|dm)
    if (parts.length === 5) {
      return keyStr;
    }
    // v1: platform:app:accountId:conversationId:peerId:(group|dm) -> drop peerId
    if (parts.length === 6) {
      return [parts[0], parts[1], parts[2], parts[3], parts[5]].join(':');
    }
  }

  // best-effort: legacy unescaped form
  // platform:app(:accountId)?:conversationId:peerId:(group|dm)
  if (parts.length < 5) return keyStr;
  const groupOrDm = parts[parts.length - 1];
  if (!isGroupFlag(groupOrDm)) return keyStr;

  const platform = parts[0] || 'web';
  const app = parts[1] || 'other';
  const conversationId = parts[parts.length - 3] || '';
  const accountId = parts.length > 5 ? parts.slice(2, parts.length - 3).join(':') : '';

  return contactKeyToString({
    platform: platform as ContactKey['platform'],
    app: app as ContactKey['app'],
    accountId: accountId || undefined,
    conversationId,
    peerId: '',
    isGroup: groupOrDm === 'group',
  });
}
