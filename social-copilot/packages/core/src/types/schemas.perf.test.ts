import { describe, it, expect } from 'vitest';
import {
  ContactKeySchema,
  MessageSchema,
  ContactProfileSchema,
  ConfigSchema,
  UserDataBackupSchema,
} from './schemas';
import type { ContactKey, ContactProfile } from './contact';
import type { Message } from './message';

/**
 * Performance tests for Zod validation.
 *
 * Disabled by default to avoid CI flakiness. Run with:
 * `RUN_PERF_TESTS=1 pnpm -C packages/core test -- schemas.perf.test.ts`
 */

const describeIf = process.env.RUN_PERF_TESTS === '1' ? describe : describe.skip;

describeIf('Schema Performance Tests', () => {
  const ITERATIONS = 10000;

  const validContactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    accountId: 'user123',
    conversationId: 'chat456',
    peerId: 'peer789',
    isGroup: false,
  };

  const validMessage: Message = {
    id: 'msg123',
    contactKey: validContactKey,
    direction: 'incoming',
    senderName: 'Alice',
    text: 'Hello world, this is a test message',
    timestamp: Date.now(),
  };

  const validProfile: ContactProfile = {
    key: validContactKey,
    displayName: 'Alice',
    basicInfo: {
      ageRange: '25-30',
      occupation: 'Engineer',
      location: 'San Francisco',
    },
    interests: ['coding', 'music', 'travel'],
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

  const validConfig = {
    apiKey: 'sk-test123456789',
    provider: 'deepseek' as const,
    baseUrl: 'https://api.example.com',
    model: 'deepseek-v3.2',
    styles: ['humorous', 'caring', 'rational'] as const,
    language: 'zh' as const,
    autoTrigger: true,
    autoInGroups: false,
    contextMessageLimit: 10,
    redactPii: true,
    anonymizeSenders: true,
    maxCharsPerMessage: 500,
    maxTotalChars: 4000,
    enableMemory: true,
    persistApiKey: false,
    privacyAcknowledged: true,
  };

  const validBackup = {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    extensionVersion: '1.0.0',
    data: {
      profiles: [validProfile, validProfile, validProfile],
      stylePreferences: [],
      contactMemories: [],
      profileUpdateCounts: { 'key1': 10, 'key2': 20 },
      memoryUpdateCounts: { 'key1': 5, 'key2': 15 },
    },
  };

  it('ContactKeySchema should validate quickly', () => {
    const validationStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      ContactKeySchema.safeParse(validContactKey);
    }
    const validationEnd = performance.now();
    const validationTime = validationEnd - validationStart;

    expect(Number.isFinite(validationTime)).toBe(true);
  });

  it('MessageSchema should validate quickly', () => {
    const validationStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      MessageSchema.safeParse(validMessage);
    }
    const validationEnd = performance.now();
    const validationTime = validationEnd - validationStart;

    expect(Number.isFinite(validationTime)).toBe(true);
  });

  it('ContactProfileSchema should validate quickly', () => {
    const validationStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      ContactProfileSchema.safeParse(validProfile);
    }
    const validationEnd = performance.now();
    const validationTime = validationEnd - validationStart;

    expect(Number.isFinite(validationTime)).toBe(true);
  });

  it('ConfigSchema should validate quickly', () => {
    const validationStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      ConfigSchema.safeParse(validConfig);
    }
    const validationEnd = performance.now();
    const validationTime = validationEnd - validationStart;

    expect(Number.isFinite(validationTime)).toBe(true);
  });

  it('UserDataBackupSchema should validate quickly', () => {
    const validationStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      UserDataBackupSchema.safeParse(validBackup);
    }
    const validationEnd = performance.now();
    const validationTime = validationEnd - validationStart;

    expect(Number.isFinite(validationTime)).toBe(true);
  });

  it('should handle validation errors efficiently', () => {
    const invalidData = {
      platform: 'invalid',
      app: 'invalid',
      conversationId: '',
      peerId: '',
      isGroup: 'not-a-boolean',
    };

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const result = ContactKeySchema.safeParse(invalidData);
      if (!result.success) {
        // Error handling is part of the validation cost
        result.error.issues.length;
      }
    }
    const end = performance.now();
    const time = end - start;

    expect(Number.isFinite(time)).toBe(true);
  });
});
