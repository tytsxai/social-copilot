import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import 'fake-indexeddb/auto';
import { IndexedDBStore } from './indexeddb-store';
import type { ReplyStyle, ContactKey, Message } from '../types';
import { contactKeyToString, contactKeyToStringV1 } from '../types/contact';

async function resetIndexedDb() {
  const store = new IndexedDBStore();
  try {
    await store.deleteDatabase();
  } catch {
    // ignore: can be blocked by leaked connections in a failing test.
  }
}

beforeEach(async () => {
  await resetIndexedDb();
});

afterEach(async () => {
  await resetIndexedDb();
});

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

describe('IndexedDBStore - Messages', () => {
  let store: IndexedDBStore;
  const contactKey: ContactKey = {
    platform: 'web',
    app: 'telegram',
    accountId: 'acc',
    conversationId: 'conv',
    peerId: 'peer',
    isGroup: false,
  };

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('counts unique messages and returns recent items in timestamp order', async () => {
    const base: Message = {
      id: 'msg-1',
      contactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'hello',
      timestamp: 1,
    };

    await store.saveMessage(base);
    // Duplicate id should overwrite instead of increasing count
    await store.saveMessage({ ...base, text: 'updated hello' });
    await store.saveMessage({ ...base, id: 'msg-2', text: 'later message', timestamp: 2 });

    const count = await store.getMessageCount(contactKey);
    expect(count).toBe(2);

    const recent = await store.getRecentMessages(contactKey, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('msg-2');
    expect(recent[0].text).toBe('later message');
  });

  test('deleteDatabase removes all data and allows clean re-init', async () => {
    await store.saveMessage({
      id: 'msg-3',
      contactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'keep me?',
      timestamp: Date.now(),
    });

    await store.deleteDatabase();

    const fresh = new IndexedDBStore();
    await fresh.init();

    const count = await fresh.getMessageCount(contactKey);
    expect(count).toBe(0);

    await fresh.close();
  });

  test('clearContact removes messages, profile, and style preferences', async () => {
    await store.saveMessage({
      id: 'msg-4',
      contactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'hello',
      timestamp: 1,
    });

    await store.saveProfile({
      key: contactKey,
      displayName: 'Alice',
      interests: [],
      createdAt: 1,
      updatedAt: 1,
    });

    await store.saveStylePreference({
      contactKeyStr: contactKeyToString(contactKey),
      styleHistory: [],
      defaultStyle: null,
      updatedAt: 1,
    });

    await store.clearContact(contactKey);

    const msgCount = await store.getMessageCount(contactKey);
    expect(msgCount).toBe(0);

    const profile = await store.getProfile(contactKey);
    expect(profile).toBeNull();

    const stylePref = await store.getStylePreference(contactKey);
    expect(stylePref).toBeNull();
  });
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

describe('IndexedDBStore - Snapshot export/import', () => {
  let store: IndexedDBStore;
  const contactKey: ContactKey = {
    platform: 'web',
    app: 'whatsapp',
    accountId: 'acc',
    conversationId: 'conv',
    peerId: 'peer',
    isGroup: false,
  };

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('exportSnapshot excludes messages and importSnapshot restores derived data', async () => {
    await store.saveMessage({
      id: 'msg-1',
      contactKey,
      direction: 'incoming',
      senderName: 'Alice',
      text: 'hello',
      timestamp: 1,
    });

    await store.saveProfile({
      key: contactKey,
      displayName: 'Alice',
      interests: ['music'],
      createdAt: 1,
      updatedAt: 1,
    });

    await store.saveStylePreference({
      contactKeyStr: contactKeyToStringV1(contactKey),
      styleHistory: [{ style: 'caring', count: 2, lastUsed: 1 }],
      defaultStyle: null,
      updatedAt: 1,
    });

    await store.saveContactMemorySummary(contactKey, 'summary');

    const snapshot = await store.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect((snapshot as unknown as { messages?: unknown }).messages).toBeUndefined();

    await store.deleteDatabase();

    const fresh = new IndexedDBStore();
    await fresh.init();
    const result = await fresh.importSnapshot(snapshot);
    expect(result.imported.profiles).toBe(1);
    expect(result.imported.stylePreferences).toBe(1);
    expect(result.imported.contactMemories).toBe(1);

    const loadedProfile = await fresh.getProfile(contactKey);
    expect(loadedProfile?.displayName).toBe('Alice');
    expect(loadedProfile?.interests).toEqual(['music']);

    const pref = await fresh.getStylePreference(contactKey);
    expect(pref?.contactKeyStr).toBe(contactKeyToString(contactKey));

    const memory = await fresh.getContactMemorySummary(contactKey);
    expect(memory?.contactKeyStr).toBe(contactKeyToString(contactKey));
    expect(memory?.summary).toBe('summary');

    await fresh.close();
  });

  test('importSnapshot normalizes v1 contactKeyStr (drops peerId)', async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      exportedAt: Date.now(),
      profiles: [
        {
          key: contactKey,
          displayName: 'Peer',
          interests: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      stylePreferences: [
        {
          contactKeyStr: contactKeyToStringV1(contactKey),
          styleHistory: [{ style: 'humorous' as const, count: 1, lastUsed: 1 }],
          defaultStyle: null,
          updatedAt: 1,
        },
      ],
      contactMemories: [
        {
          contactKeyStr: contactKeyToStringV1(contactKey),
          summary: 'm',
          updatedAt: 1,
        },
      ],
    };

    const result = await store.importSnapshot(snapshot);
    expect(result.skipped.profiles).toBe(0);
    expect(result.skipped.stylePreferences).toBe(0);
    expect(result.skipped.contactMemories).toBe(0);

    const pref = await store.getStylePreference(contactKey);
    expect(pref?.contactKeyStr).toBe(contactKeyToString(contactKey));

    const memory = await store.getContactMemorySummary(contactKey);
    expect(memory?.contactKeyStr).toBe(contactKeyToString(contactKey));
  });
});

describe('IndexedDBStore - Rollback Compatibility', () => {
  test('init opens DB even if on-disk version is higher', async () => {
    const deleteDb = async (): Promise<void> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('social-copilot');
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('deleteDatabase blocked'));
        req.onsuccess = () => resolve();
      });

    const bumpDbVersion = async (version: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('social-copilot', version);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
          // No schema changes; we only want to bump the version.
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
      });

    await deleteDb();

    const baseline = new IndexedDBStore();
    await baseline.init();
    await baseline.close();

    await bumpDbVersion(999);

    const rolledBack = new IndexedDBStore();
    await rolledBack.init();

    const contactKey: ContactKey = {
      platform: 'web',
      app: 'telegram',
      accountId: 'acc',
      conversationId: 'conv',
      peerId: 'peer',
      isGroup: false,
    };
    const count = await rolledBack.getMessageCount(contactKey);
    expect(count).toBeTypeOf('number');

    await rolledBack.close();
    await deleteDb();
  });
});

describe('IndexedDBStore - Contact Memories', () => {
  let store: IndexedDBStore;
  const contactKey: ContactKey = {
    platform: 'web',
    app: 'whatsapp',
    accountId: 'acc',
    conversationId: 'conv',
    peerId: 'peer',
    isGroup: false,
  };

  beforeEach(async () => {
    store = new IndexedDBStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('saveContactMemorySummaryRecord preserves updatedAt and normalizes legacy key', async () => {
    const legacyKeyStr = contactKeyToStringV1(contactKey);
    const updatedAt = 123456;

    await store.saveContactMemorySummaryRecord({
      contactKeyStr: legacyKeyStr,
      summary: 'hello',
      updatedAt,
    });

    const all = await store.getAllContactMemorySummaries();
    expect(all).toHaveLength(1);

    // v1 key should be normalized to v2 (peerId excluded).
    expect(all[0].contactKeyStr).toBe(contactKeyToString(contactKey));
    expect(all[0].summary).toBe('hello');
    expect(all[0].updatedAt).toBe(updatedAt);

    const fetched = await store.getContactMemorySummary(contactKey);
    expect(fetched).not.toBeNull();
    expect(fetched?.contactKeyStr).toBe(contactKeyToString(contactKey));
    expect(fetched?.summary).toBe('hello');
    expect(fetched?.updatedAt).toBe(updatedAt);
  });
});
