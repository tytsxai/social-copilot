import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import 'fake-indexeddb/auto';
import { IndexedDBStore } from './indexeddb-store';
import type { ReplyStyle, ContactKey } from '../types';
import { contactKeyToString } from '../types/contact';

// Generators for property-based testing
const replyStyleArb = fc.constantFrom<ReplyStyle>('humorous', 'caring', 'rational', 'casual', 'formal');

const styleHistoryEntryArb = fc.record({
  style: replyStyleArb,
  count: fc.integer({ min: 1, max: 100 }),
  lastUsed: fc.integer({ min: 0, max: Date.now() }),
});

const contactKeyArb = fc.record({
  platform: fc.constantFrom<ContactKey['platform']>('web', 'windows', 'mac', 'android', 'ios'),
  app: fc.constantFrom<ContactKey['app']>('telegram', 'whatsapp', 'slack', 'discord', 'wechat', 'qq', 'other'),
  accountId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  conversationId: fc.string({ minLength: 1, maxLength: 50 }),
  peerId: fc.string({ minLength: 1, maxLength: 50 }),
  isGroup: fc.boolean(),
});

const stylePreferenceArb = fc.record({
  contactKeyStr: contactKeyArb.map(contactKeyToString),
  styleHistory: fc.array(styleHistoryEntryArb, { minLength: 0, maxLength: 5 }),
  defaultStyle: fc.option(replyStyleArb, { nil: null }),
  updatedAt: fc.integer({ min: 0, max: Date.now() }),
});

describe('IndexedDBStore - Style Preferences', () => {
  let store: IndexedDBStore;

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  /**
   * **Feature: experience-optimization, Property 8: Config serialization round-trip**
   * **Validates: Requirements 2.5, 2.6**
   */
  test.each(
    fc.sample(stylePreferenceArb, { numRuns: 100 })
  )('style preference storage round-trip preserves data: %#', async (preference) => {
    // Save the preference
    await store.saveStylePreference(preference);

    // Retrieve it using getAllStylePreferences and find by contactKeyStr
    const allPrefs = await store.getAllStylePreferences();
    const retrieved = allPrefs.find(p => p.contactKeyStr === preference.contactKeyStr);

    expect(retrieved).toBeDefined();
    expect(retrieved).toEqual(preference);
  });
});
