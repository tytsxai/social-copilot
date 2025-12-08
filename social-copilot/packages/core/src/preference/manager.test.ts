import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import 'fake-indexeddb/auto';
import { StylePreferenceManager } from './manager';
import { IndexedDBStore } from '../memory/indexeddb-store';
import type { ReplyStyle, ContactKey } from '../types';
import { contactKeyToString } from '../types/contact';

// Generators for property-based testing
const replyStyleArb = fc.constantFrom<ReplyStyle>('humorous', 'caring', 'rational', 'casual', 'formal');

const contactKeyArb: fc.Arbitrary<ContactKey> = fc.record({
  platform: fc.constantFrom<ContactKey['platform']>('web', 'windows', 'mac', 'android', 'ios'),
  app: fc.constantFrom<ContactKey['app']>('telegram', 'whatsapp', 'slack', 'discord', 'wechat', 'qq', 'other'),
  accountId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  conversationId: fc.string({ minLength: 1, maxLength: 50 }),
  peerId: fc.string({ minLength: 1, maxLength: 50 }),
  isGroup: fc.boolean(),
});

describe('StylePreferenceManager', () => {
  let store: IndexedDBStore;
  let manager: StylePreferenceManager;

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.init();
    manager = new StylePreferenceManager(store);
  });

  afterEach(async () => {
    await store.close();
  });

  /**
   * **Feature: experience-optimization, Property 1: Style selection recording**
   * **Validates: Requirements 1.1, 1.5**
   */
  test.each(
    fc.sample(fc.tuple(contactKeyArb, replyStyleArb), { numRuns: 100 }).map(tuple => [tuple])
  )('style selection should update history with incremented count: %#', async (tuple) => {
    const [contactKey, style] = tuple;
    // Get initial state
    const initialPref = await manager.getPreference(contactKey);
    const initialCount = initialPref?.styleHistory.find(e => e.style === style)?.count ?? 0;

    // Record the selection
    await manager.recordStyleSelection(contactKey, style);

    // Verify the count was incremented
    const updatedPref = await manager.getPreference(contactKey);
    expect(updatedPref).toBeDefined();
    
    const updatedEntry = updatedPref!.styleHistory.find(e => e.style === style);
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry!.count).toBe(initialCount + 1);
  });

  /**
   * **Feature: experience-optimization, Property 2: Style prioritization by history**
   * **Validates: Requirements 1.2**
   */
  test.each(
    fc.sample(
      fc.tuple(
        contactKeyArb,
        fc.array(replyStyleArb, { minLength: 1, maxLength: 20 })
      ),
      { numRuns: 100 }
    ).map(tuple => [tuple])
  )('recommended styles should be ordered by selection count descending: %#', async (tuple) => {
    const [contactKey, styleSelections] = tuple;
    
    // Record multiple style selections
    for (const style of styleSelections) {
      await manager.recordStyleSelection(contactKey, style);
    }

    // Get recommended styles
    const recommended = await manager.getRecommendedStyles(contactKey);
    const preference = await manager.getPreference(contactKey);

    // Verify that used styles come first, ordered by count descending
    if (preference && preference.styleHistory.length > 0) {
      const sortedHistory = [...preference.styleHistory].sort((a, b) => b.count - a.count);
      const expectedUsedStyles = sortedHistory.map(e => e.style);
      
      // The first N styles should match the sorted history
      for (let i = 0; i < expectedUsedStyles.length; i++) {
        expect(recommended[i]).toBe(expectedUsedStyles[i]);
      }
    }
  });

  /**
   * **Feature: experience-optimization, Property 3: Default style threshold**
   * **Validates: Requirements 1.3**
   */
  test.each(
    fc.sample(
      fc.tuple(
        contactKeyArb,
        replyStyleArb,
        fc.integer({ min: 1, max: 10 })
      ),
      { numRuns: 100 }
    ).map(tuple => [tuple])
  )('style selected 3+ times should become default: %#', async (tuple) => {
    const [contactKey, style, selectionCount] = tuple;
    
    // Record the style multiple times
    for (let i = 0; i < selectionCount; i++) {
      await manager.recordStyleSelection(contactKey, style);
    }

    // Get the preference
    const preference = await manager.getPreference(contactKey);
    expect(preference).toBeDefined();

    // Verify default style is set correctly based on threshold
    if (selectionCount >= 3) {
      expect(preference!.defaultStyle).toBe(style);
    } else {
      expect(preference!.defaultStyle).toBeNull();
    }
  });

  test('default style switches to the most used style after threshold is exceeded', async () => {
    const contactKey = fc.sample(contactKeyArb, { numRuns: 1 })[0];

    await manager.recordStyleSelection(contactKey, 'humorous');
    await manager.recordStyleSelection(contactKey, 'humorous');
    await manager.recordStyleSelection(contactKey, 'humorous'); // humorous hits threshold

    await manager.recordStyleSelection(contactKey, 'caring');
    await manager.recordStyleSelection(contactKey, 'caring');
    await manager.recordStyleSelection(contactKey, 'caring');
    await manager.recordStyleSelection(contactKey, 'caring'); // caring surpasses humorous

    const preference = await manager.getPreference(contactKey);
    expect(preference?.defaultStyle).toBe('caring');
  });

  /**
   * **Feature: experience-optimization, Property 13: Reset preserves non-preference data**
   * **Validates: Requirements 5.3**
   */
  test.each(
    fc.sample(
      fc.tuple(
        contactKeyArb,
        fc.array(replyStyleArb, { minLength: 1, maxLength: 5 }),
        fc.record({
          displayName: fc.string({ minLength: 1, maxLength: 50 }),
          interests: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
        })
      ),
      { numRuns: 100 }
    ).map(tuple => [tuple])
  )('reset should clear style preferences while preserving profile data: %#', async (tuple) => {
    const [contactKey, styleSelections, profileData] = tuple;
    
    // Create a profile for the contact
    const profile = {
      key: contactKey,
      displayName: profileData.displayName,
      interests: profileData.interests,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.saveProfile(profile);

    // Record some style selections
    for (const style of styleSelections) {
      await manager.recordStyleSelection(contactKey, style);
    }

    // Verify preference exists
    const prefBefore = await manager.getPreference(contactKey);
    expect(prefBefore).toBeDefined();
    expect(prefBefore!.styleHistory.length).toBeGreaterThan(0);

    // Reset preferences
    await manager.resetPreference(contactKey);

    // Verify preference is cleared
    const prefAfter = await manager.getPreference(contactKey);
    expect(prefAfter).toBeFalsy();

    // Verify profile is preserved
    const profileAfter = await store.getProfile(contactKey);
    expect(profileAfter).toBeDefined();
    expect(profileAfter!.displayName).toBe(profileData.displayName);
    expect(profileAfter!.interests).toEqual(profileData.interests);
  });

  /**
   * **Feature: experience-optimization, Property 14: Export includes all preferences**
   * **Validates: Requirements 5.4**
   */
  test.each(
    fc.sample(
      fc.array(
        fc.tuple(
          contactKeyArb,
          fc.array(replyStyleArb, { minLength: 1, maxLength: 5 })
        ),
        { minLength: 1, maxLength: 10 }
      ),
      { numRuns: 100 }
    ).map(arr => [arr])
  )('export should include all contacts with style history: %#', async (contactsWithStyles) => {
    // Record style selections for multiple contacts
    const contactKeyStrs = new Set<string>();
    for (const [contactKey, styles] of contactsWithStyles) {
      const keyStr = contactKeyToString(contactKey);
      contactKeyStrs.add(keyStr);
      for (const style of styles) {
        await manager.recordStyleSelection(contactKey, style);
      }
    }

    // Export all preferences
    const exported = await manager.exportPreferences();

    // Verify all contacts with style history are included
    const exportedKeyStrs = new Set(exported.map(p => p.contactKeyStr));
    
    // All recorded contacts should be in the export
    for (const keyStr of contactKeyStrs) {
      expect(exportedKeyStrs.has(keyStr)).toBe(true);
    }
  });
});
