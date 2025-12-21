import { describe, it, expect } from 'vitest';
import {
  ContactKeySchema,
  MessageSchema,
  ContactProfileSchema,
  StylePreferenceSchema,
  ContactMemorySummarySchema,
  ConfigSchema,
  LLMInputSchema,
  UserDataBackupSchema,
  GenerateReplyPayloadSchema,
  formatZodError,
} from './schemas';
import type { ContactKey, ContactProfile } from './contact';
import type { Message } from './message';

describe('ContactKeySchema', () => {
  it('should validate a valid ContactKey', () => {
    const validKey: ContactKey = {
      platform: 'web',
      app: 'telegram',
      accountId: 'user123',
      conversationId: 'chat456',
      peerId: 'peer789',
      isGroup: false,
    };

    const result = ContactKeySchema.safeParse(validKey);
    expect(result.success).toBe(true);
  });

  it('should validate ContactKey without optional accountId', () => {
    const validKey = {
      platform: 'web',
      app: 'whatsapp',
      conversationId: 'chat456',
      peerId: 'peer789',
      isGroup: true,
    };

    const result = ContactKeySchema.safeParse(validKey);
    expect(result.success).toBe(true);
  });

  it('should reject invalid platform', () => {
    const invalidKey = {
      platform: 'invalid',
      app: 'telegram',
      conversationId: 'chat456',
      peerId: 'peer789',
      isGroup: false,
    };

    const result = ContactKeySchema.safeParse(invalidKey);
    expect(result.success).toBe(false);
  });

  it('should reject invalid app', () => {
    const invalidKey = {
      platform: 'web',
      app: 'invalid',
      conversationId: 'chat456',
      peerId: 'peer789',
      isGroup: false,
    };

    const result = ContactKeySchema.safeParse(invalidKey);
    expect(result.success).toBe(false);
  });

  it('should reject empty conversationId', () => {
    const invalidKey = {
      platform: 'web',
      app: 'telegram',
      conversationId: '',
      peerId: 'peer789',
      isGroup: false,
    };

    const result = ContactKeySchema.safeParse(invalidKey);
    expect(result.success).toBe(false);
  });

  it('should reject empty peerId', () => {
    const invalidKey = {
      platform: 'web',
      app: 'telegram',
      conversationId: 'chat456',
      peerId: '',
      isGroup: false,
    };

    const result = ContactKeySchema.safeParse(invalidKey);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const invalidKey = {
      platform: 'web',
      app: 'telegram',
    };

    const result = ContactKeySchema.safeParse(invalidKey);
    expect(result.success).toBe(false);
  });
});

describe('MessageSchema', () => {
  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  it('should validate a valid Message', () => {
    const validMessage: Message = {
      id: 'msg123',
      contactKey: validContactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'Hello world',
      timestamp: Date.now(),
    };

    const result = MessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it('should validate Message with optional raw field', () => {
    const validMessage = {
      id: 'msg123',
      contactKey: validContactKey,
      direction: 'outgoing',
      senderName: 'Bob',
      text: 'Hi there',
      timestamp: Date.now(),
      raw: { some: 'data' },
    };

    const result = MessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it('should reject invalid direction', () => {
    const invalidMessage = {
      id: 'msg123',
      contactKey: validContactKey,
      direction: 'invalid',
      senderName: 'Alice',
      text: 'Hello',
      timestamp: Date.now(),
    };

    const result = MessageSchema.safeParse(invalidMessage);
    expect(result.success).toBe(false);
  });

  it('should reject empty message id', () => {
    const invalidMessage = {
      id: '',
      contactKey: validContactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'Hello',
      timestamp: Date.now(),
    };

    const result = MessageSchema.safeParse(invalidMessage);
    expect(result.success).toBe(false);
  });

  it('should reject negative timestamp', () => {
    const invalidMessage = {
      id: 'msg123',
      contactKey: validContactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'Hello',
      timestamp: -1,
    };

    const result = MessageSchema.safeParse(invalidMessage);
    expect(result.success).toBe(false);
  });

  it('should reject zero timestamp', () => {
    const invalidMessage = {
      id: 'msg123',
      contactKey: validContactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'Hello',
      timestamp: 0,
    };

    const result = MessageSchema.safeParse(invalidMessage);
    expect(result.success).toBe(false);
  });
});

describe('ContactProfileSchema', () => {
  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  it('should validate a valid ContactProfile', () => {
    const validProfile: ContactProfile = {
      key: validContactKey,
      displayName: 'Alice',
      interests: ['coding', 'music'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = ContactProfileSchema.safeParse(validProfile);
    expect(result.success).toBe(true);
  });

  it('should validate ContactProfile with all optional fields', () => {
    const validProfile = {
      key: validContactKey,
      displayName: 'Bob',
      basicInfo: {
        ageRange: '25-30',
        occupation: 'Engineer',
        location: 'San Francisco',
      },
      interests: ['sports', 'travel'],
      communicationStyle: {
        prefersShortMessages: true,
        usesEmoji: true,
        formalityLevel: 'casual' as const,
      },
      relationshipType: 'friend' as const,
      notes: 'Met at conference',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = ContactProfileSchema.safeParse(validProfile);
    expect(result.success).toBe(true);
  });

  it('should reject empty displayName', () => {
    const invalidProfile = {
      key: validContactKey,
      displayName: '',
      interests: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = ContactProfileSchema.safeParse(invalidProfile);
    expect(result.success).toBe(false);
  });

  it('should reject invalid formalityLevel', () => {
    const invalidProfile = {
      key: validContactKey,
      displayName: 'Alice',
      interests: [],
      communicationStyle: {
        formalityLevel: 'invalid',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = ContactProfileSchema.safeParse(invalidProfile);
    expect(result.success).toBe(false);
  });

  it('should reject invalid relationshipType', () => {
    const invalidProfile = {
      key: validContactKey,
      displayName: 'Alice',
      interests: [],
      relationshipType: 'invalid',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = ContactProfileSchema.safeParse(invalidProfile);
    expect(result.success).toBe(false);
  });
});

describe('StylePreferenceSchema', () => {
  it('should validate a valid StylePreference', () => {
    const validPreference = {
      contactKeyStr: 'web:telegram::chat456:dm',
      styleHistory: [
        { style: 'humorous', count: 5, lastUsed: Date.now() },
        { style: 'caring', count: 3, lastUsed: Date.now() - 1000 },
      ],
      defaultStyle: 'humorous' as const,
      updatedAt: Date.now(),
    };

    const result = StylePreferenceSchema.safeParse(validPreference);
    expect(result.success).toBe(true);
  });

  it('should validate StylePreference with null defaultStyle', () => {
    const validPreference = {
      contactKeyStr: 'web:telegram::chat456:dm',
      styleHistory: [],
      defaultStyle: null,
      updatedAt: Date.now(),
    };

    const result = StylePreferenceSchema.safeParse(validPreference);
    expect(result.success).toBe(true);
  });

  it('should reject empty contactKeyStr', () => {
    const invalidPreference = {
      contactKeyStr: '',
      styleHistory: [],
      defaultStyle: null,
      updatedAt: Date.now(),
    };

    const result = StylePreferenceSchema.safeParse(invalidPreference);
    expect(result.success).toBe(false);
  });

  it('should reject invalid style in styleHistory', () => {
    const invalidPreference = {
      contactKeyStr: 'web:telegram::chat456:dm',
      styleHistory: [
        { style: 'invalid', count: 5, lastUsed: Date.now() },
      ],
      defaultStyle: null,
      updatedAt: Date.now(),
    };

    const result = StylePreferenceSchema.safeParse(invalidPreference);
    expect(result.success).toBe(false);
  });

  it('should reject negative count in styleHistory', () => {
    const invalidPreference = {
      contactKeyStr: 'web:telegram::chat456:dm',
      styleHistory: [
        { style: 'humorous', count: -1, lastUsed: Date.now() },
      ],
      defaultStyle: null,
      updatedAt: Date.now(),
    };

    const result = StylePreferenceSchema.safeParse(invalidPreference);
    expect(result.success).toBe(false);
  });
});

describe('ContactMemorySummarySchema', () => {
  it('should validate a valid ContactMemorySummary', () => {
    const validMemory = {
      contactKeyStr: 'web:telegram::chat456:dm',
      summary: 'User prefers technical discussions',
      updatedAt: Date.now(),
    };

    const result = ContactMemorySummarySchema.safeParse(validMemory);
    expect(result.success).toBe(true);
  });

  it('should reject empty contactKeyStr', () => {
    const invalidMemory = {
      contactKeyStr: '',
      summary: 'Some summary',
      updatedAt: Date.now(),
    };

    const result = ContactMemorySummarySchema.safeParse(invalidMemory);
    expect(result.success).toBe(false);
  });

  it('should reject empty summary', () => {
    const invalidMemory = {
      contactKeyStr: 'web:telegram::chat456:dm',
      summary: '',
      updatedAt: Date.now(),
    };

    const result = ContactMemorySummarySchema.safeParse(invalidMemory);
    expect(result.success).toBe(false);
  });
});

describe('ConfigSchema', () => {
  it('should validate a valid Config', () => {
    const validConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek' as const,
      styles: ['humorous', 'caring'] as const,
    };

    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should validate Config with all optional fields', () => {
    const validConfig = {
      apiKey: 'sk-test123',
      provider: 'openai' as const,
      baseUrl: 'https://api.example.com',
      allowInsecureHttp: true,
      allowPrivateHosts: true,
      model: 'gpt-4',
      styles: ['humorous', 'caring', 'rational'] as const,
      language: 'zh' as const,
      autoTrigger: true,
      autoInGroups: false,
      contextMessageLimit: 10,
      redactPii: true,
      anonymizeSenders: true,
      maxCharsPerMessage: 500,
      maxTotalChars: 4000,
      fallbackProvider: 'claude' as const,
      fallbackBaseUrl: 'https://api.fallback.com',
      fallbackAllowInsecureHttp: true,
      fallbackAllowPrivateHosts: true,
      fallbackModel: 'claude-3',
      fallbackApiKey: 'sk-fallback123',
      enableFallback: true,
      suggestionCount: 3 as const,
      enableMemory: true,
      persistApiKey: false,
      privacyAcknowledged: true,
    };

    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should reject empty apiKey', () => {
    const invalidConfig = {
      apiKey: '',
      provider: 'deepseek',
      styles: ['humorous'],
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider', () => {
    const invalidConfig = {
      apiKey: 'sk-test123',
      provider: 'invalid',
      styles: ['humorous'],
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject empty styles array', () => {
    const invalidConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek',
      styles: [],
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject invalid baseUrl', () => {
    const invalidConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek',
      baseUrl: 'not-a-url',
      styles: ['humorous'],
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject contextMessageLimit out of range', () => {
    const invalidConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek',
      styles: ['humorous'],
      contextMessageLimit: 100,
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject enableFallback without fallbackApiKey', () => {
    const invalidConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek',
      styles: ['humorous'],
      enableFallback: true,
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('fallbackApiKey');
    }
  });

  it('should accept enableFallback with fallbackApiKey', () => {
    const validConfig = {
      apiKey: 'sk-test123',
      provider: 'deepseek',
      styles: ['humorous'],
      enableFallback: true,
      fallbackApiKey: 'sk-fallback123',
    };

    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });
});

describe('LLMInputSchema', () => {
  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  const validMessage: Message = {
    id: 'msg123',
    contactKey: validContactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: 'Hello',
    timestamp: Date.now(),
  };

  it('should validate a valid LLMInput', () => {
    const validInput = {
      context: {
        contactKey: validContactKey,
        recentMessages: [validMessage],
        currentMessage: validMessage,
      },
      styles: ['humorous', 'caring'] as const,
      language: 'zh' as const,
    };

    const result = LLMInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should validate LLMInput with all optional fields', () => {
    const validProfile: ContactProfile = {
      key: validContactKey,
      displayName: 'Alice',
      interests: ['coding'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const validInput = {
      context: {
        contactKey: validContactKey,
        recentMessages: [validMessage],
        currentMessage: validMessage,
      },
      profile: validProfile,
      memorySummary: 'User likes technical topics',
      styles: ['rational'] as const,
      language: 'en' as const,
      maxLength: 500,
      task: 'reply' as const,
      thoughtDirection: 'empathy' as const,
      thoughtHint: 'Show understanding',
    };

    const result = LLMInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should reject empty styles array', () => {
    const invalidInput = {
      context: {
        contactKey: validContactKey,
        recentMessages: [validMessage],
        currentMessage: validMessage,
      },
      styles: [],
      language: 'zh',
    };

    const result = LLMInputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it('should reject invalid language', () => {
    const invalidInput = {
      context: {
        contactKey: validContactKey,
        recentMessages: [validMessage],
        currentMessage: validMessage,
      },
      styles: ['humorous'],
      language: 'fr',
    };

    const result = LLMInputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it('should reject invalid task', () => {
    const invalidInput = {
      context: {
        contactKey: validContactKey,
        recentMessages: [validMessage],
        currentMessage: validMessage,
      },
      styles: ['humorous'],
      language: 'zh',
      task: 'invalid',
    };

    const result = LLMInputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });
});

describe('UserDataBackupSchema', () => {
  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  const validProfile: ContactProfile = {
    key: validContactKey,
    displayName: 'Alice',
    interests: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should validate a valid UserDataBackup', () => {
    const validBackup = {
      schemaVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      extensionVersion: '1.0.0',
      data: {
        profiles: [validProfile],
        stylePreferences: [],
        contactMemories: [],
        profileUpdateCounts: { 'web:telegram::chat456:dm': 10 },
        memoryUpdateCounts: { 'web:telegram::chat456:dm': 5 },
      },
    };

    const result = UserDataBackupSchema.safeParse(validBackup);
    expect(result.success).toBe(true);
  });

  it('should reject invalid schemaVersion', () => {
    const invalidBackup = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      data: {
        profiles: [],
        stylePreferences: [],
        contactMemories: [],
        profileUpdateCounts: {},
        memoryUpdateCounts: {},
      },
    };

    const result = UserDataBackupSchema.safeParse(invalidBackup);
    expect(result.success).toBe(false);
  });

  it('should reject missing data field', () => {
    const invalidBackup = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
    };

    const result = UserDataBackupSchema.safeParse(invalidBackup);
    expect(result.success).toBe(false);
  });

  it('should reject invalid profile in profiles array', () => {
    const invalidBackup = {
      schemaVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      data: {
        profiles: [{ invalid: 'profile' }],
        stylePreferences: [],
        contactMemories: [],
        profileUpdateCounts: {},
        memoryUpdateCounts: {},
      },
    };

    const result = UserDataBackupSchema.safeParse(invalidBackup);
    expect(result.success).toBe(false);
  });

  it('should reject negative count in profileUpdateCounts', () => {
    const invalidBackup = {
      schemaVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      data: {
        profiles: [],
        stylePreferences: [],
        contactMemories: [],
        profileUpdateCounts: { 'key1': -5 },
        memoryUpdateCounts: {},
      },
    };

    const result = UserDataBackupSchema.safeParse(invalidBackup);
    expect(result.success).toBe(false);
  });
});

describe('GenerateReplyPayloadSchema', () => {
  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  const validMessage: Message = {
    id: 'msg123',
    contactKey: validContactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: 'Hello',
    timestamp: Date.now(),
  };

  it('should validate a valid GenerateReplyPayload', () => {
    const validPayload = {
      contactKey: validContactKey,
      messages: [validMessage],
      currentMessage: validMessage,
    };

    const result = GenerateReplyPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should validate GenerateReplyPayload with thoughtDirection', () => {
    const validPayload = {
      contactKey: validContactKey,
      messages: [validMessage],
      currentMessage: validMessage,
      thoughtDirection: 'humor' as const,
    };

    const result = GenerateReplyPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should reject invalid thoughtDirection', () => {
    const invalidPayload = {
      contactKey: validContactKey,
      messages: [validMessage],
      currentMessage: validMessage,
      thoughtDirection: 'invalid',
    };

    const result = GenerateReplyPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });
});

describe('formatZodError', () => {
  it('should format Zod error with single issue', () => {
    const result = ContactKeySchema.safeParse({
      platform: 'invalid',
      app: 'telegram',
      conversationId: 'chat456',
      peerId: 'peer789',
      isGroup: false,
    });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('platform');
    }
  });

  it('should format Zod error with multiple issues', () => {
    const result = ContactKeySchema.safeParse({
      platform: 'invalid',
      app: 'invalid',
      conversationId: '',
      peerId: '',
      isGroup: false,
    });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('platform');
      expect(formatted).toContain('app');
      expect(formatted).toContain('conversationId');
      expect(formatted).toContain('peerId');
    }
  });

  it('should format nested path correctly', () => {
    const result = ContactProfileSchema.safeParse({
      key: {
        platform: 'web',
        app: 'telegram',
        conversationId: 'chat456',
        peerId: 'peer789',
        isGroup: false,
      },
      displayName: 'Alice',
      interests: [],
      communicationStyle: {
        formalityLevel: 'invalid',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('communicationStyle.formalityLevel');
    }
  });
});
