import { z } from 'zod';

/**
 * Zod schemas for runtime validation of core types
 */

// ContactKey Schema
export const ContactKeySchema = z.object({
  platform: z.enum(['web', 'windows', 'mac', 'android', 'ios']),
  app: z.enum(['telegram', 'whatsapp', 'slack', 'discord', 'wechat', 'qq', 'other']),
  accountId: z.string().optional(),
  conversationId: z.string().min(1, 'conversationId cannot be empty'),
  peerId: z.string().min(1, 'peerId cannot be empty'),
  isGroup: z.boolean(),
});

// Message Schema
export const MessageDirectionSchema = z.enum(['incoming', 'outgoing']);

export const MessageSchema = z.object({
  id: z.string().min(1, 'Message id cannot be empty'),
  contactKey: ContactKeySchema,
  direction: MessageDirectionSchema,
  senderName: z.string(),
  text: z.string(),
  timestamp: z.number().int().positive('timestamp must be positive'),
  raw: z.unknown().optional(),
});

// ContactProfile Schema
export const ContactProfileSchema = z.object({
  key: ContactKeySchema,
  displayName: z.string().min(1, 'displayName cannot be empty'),
  basicInfo: z.object({
    ageRange: z.string().optional(),
    occupation: z.string().optional(),
    location: z.string().optional(),
  }).optional(),
  interests: z.array(z.string()),
  communicationStyle: z.object({
    prefersShortMessages: z.boolean().optional(),
    usesEmoji: z.boolean().optional(),
    formalityLevel: z.enum(['casual', 'neutral', 'formal']).optional(),
  }).optional(),
  relationshipType: z.enum(['friend', 'colleague', 'family', 'acquaintance', 'romantic', 'other']).optional(),
  notes: z.string().optional(),
  createdAt: z.number().int().positive('createdAt must be positive'),
  updatedAt: z.number().int().positive('updatedAt must be positive'),
});

// StylePreference Schema
export const ReplyStyleSchema = z.enum(['humorous', 'caring', 'rational', 'casual', 'formal']);

export const StyleHistoryEntrySchema = z.object({
  style: ReplyStyleSchema,
  count: z.number().int().nonnegative('count must be non-negative'),
  lastUsed: z.number().int().positive('lastUsed must be positive'),
});

export const StylePreferenceSchema = z.object({
  contactKeyStr: z.string().min(1, 'contactKeyStr cannot be empty'),
  styleHistory: z.array(StyleHistoryEntrySchema),
  defaultStyle: ReplyStyleSchema.nullable(),
  updatedAt: z.number().int().positive('updatedAt must be positive'),
});

// ContactMemorySummary Schema
export const ContactMemorySummarySchema = z.object({
  contactKeyStr: z.string().min(1, 'contactKeyStr cannot be empty'),
  summary: z.string().min(1, 'summary cannot be empty'),
  updatedAt: z.number().int().positive('updatedAt must be positive'),
});

// Config Schema
export const ProviderTypeSchema = z.enum(['openai', 'claude', 'deepseek']);

export const ConfigSchema = z.object({
  apiKey: z.string().min(1, 'apiKey cannot be empty'),
  provider: ProviderTypeSchema,
  baseUrl: z.string().url('baseUrl must be a valid URL').optional(),
  allowInsecureHttp: z.boolean().optional(),
  allowPrivateHosts: z.boolean().optional(),
  model: z.string().optional(),
  styles: z.array(ReplyStyleSchema).min(1, 'styles must have at least one element'),
  language: z.enum(['zh', 'en', 'auto']).optional(),
  autoTrigger: z.boolean().optional(),
  autoInGroups: z.boolean().optional(),
  contextMessageLimit: z.number().int().min(1).max(50).optional(),
  redactPii: z.boolean().optional(),
  anonymizeSenders: z.boolean().optional(),
  maxCharsPerMessage: z.number().int().min(50).max(4000).optional(),
  maxTotalChars: z.number().int().min(200).max(20000).optional(),
  fallbackProvider: ProviderTypeSchema.optional(),
  fallbackBaseUrl: z.string().url('fallbackBaseUrl must be a valid URL').optional(),
  fallbackAllowInsecureHttp: z.boolean().optional(),
  fallbackAllowPrivateHosts: z.boolean().optional(),
  fallbackModel: z.string().optional(),
  fallbackApiKey: z.string().optional(),
  enableFallback: z.boolean().optional(),
  suggestionCount: z.union([z.literal(2), z.literal(3)]).optional(),
  enableMemory: z.boolean().optional(),
  persistApiKey: z.boolean().optional(),
  privacyAcknowledged: z.boolean().optional(),
}).refine(
  (data) => {
    // If enableFallback is true, fallbackApiKey must be provided
    if (data.enableFallback && !data.fallbackApiKey) {
      return false;
    }
    return true;
  },
  {
    message: 'fallbackApiKey is required when enableFallback is true',
    path: ['fallbackApiKey'],
  }
);

// LLMInput Schema
export const ConversationContextSchema = z.object({
  contactKey: ContactKeySchema,
  recentMessages: z.array(MessageSchema),
  currentMessage: MessageSchema,
});

export const ThoughtTypeSchema = z.enum([
  'empathy',
  'solution',
  'humor',
  'neutral',
]);

export const LLMInputSchema = z.object({
  context: ConversationContextSchema,
  profile: ContactProfileSchema.optional(),
  memorySummary: z.string().optional(),
  styles: z.array(ReplyStyleSchema).min(1, 'styles must have at least one element'),
  language: z.enum(['zh', 'en', 'auto']),
  maxLength: z.number().int().positive().optional(),
  task: z.enum(['reply', 'profile_extraction', 'memory_extraction']).optional(),
  thoughtDirection: ThoughtTypeSchema.optional(),
  thoughtHint: z.string().optional(),
});

// UserDataBackup Schema (for importUserData)
export const UserDataBackupSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  extensionVersion: z.string().optional(),
  data: z.object({
    profiles: z.array(ContactProfileSchema),
    stylePreferences: z.array(StylePreferenceSchema),
    contactMemories: z.array(ContactMemorySummarySchema),
    profileUpdateCounts: z.record(z.string(), z.number().int().nonnegative()),
    memoryUpdateCounts: z.record(z.string(), z.number().int().nonnegative()),
  }),
});

// Message Request Schemas (for dispatchMessage)
export const GenerateReplyPayloadSchema = z.object({
  contactKey: ContactKeySchema,
  messages: z.array(MessageSchema),
  currentMessage: MessageSchema,
  thoughtDirection: ThoughtTypeSchema.optional(),
});

export const AnalyzeThoughtPayloadSchema = z.object({
  context: ConversationContextSchema,
});

export const SetConfigRequestSchema = z.object({
  type: z.literal('SET_CONFIG'),
  config: ConfigSchema,
  requestId: z.string().optional(),
});

export const GenerateReplyRequestSchema = z.object({
  type: z.literal('GENERATE_REPLY'),
  payload: GenerateReplyPayloadSchema,
  requestId: z.string().optional(),
});

export const AnalyzeThoughtRequestSchema = z.object({
  type: z.literal('ANALYZE_THOUGHT'),
  payload: AnalyzeThoughtPayloadSchema,
  requestId: z.string().optional(),
});

// Helper function to format Zod validation errors
export function formatZodError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
  return issues.join('; ');
}
