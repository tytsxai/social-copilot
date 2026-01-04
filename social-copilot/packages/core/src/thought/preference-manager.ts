import type { ContactKey, ThoughtType, ThoughtPreference, ThoughtHistoryEntry } from '../types';
import { contactKeyToString } from '../types/contact';
import { THOUGHT_TYPES } from '../types/thought';
import type { IndexedDBStore } from '../memory/indexeddb-store';

/** Threshold for setting a default thought */
const DEFAULT_THOUGHT_THRESHOLD = 3;
const THOUGHT_SET: ReadonlySet<ThoughtType> = new Set(THOUGHT_TYPES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeThoughtHistory(raw: unknown): ThoughtHistoryEntry[] {
  if (!Array.isArray(raw)) return [];

  const merged = new Map<ThoughtType, ThoughtHistoryEntry>();

  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const thought = item.thought;
    if (!THOUGHT_SET.has(thought as ThoughtType)) continue;

    const countRaw = item.count;
    const lastUsedRaw = item.lastUsed;
    if (typeof countRaw !== 'number' || !Number.isFinite(countRaw)) continue;
    if (typeof lastUsedRaw !== 'number' || !Number.isFinite(lastUsedRaw)) continue;

    const count = Math.floor(countRaw);
    const lastUsed = Math.floor(lastUsedRaw);
    if (count <= 0 || lastUsed < 0) continue;

    const existing = merged.get(thought as ThoughtType);
    if (!existing) {
      merged.set(thought as ThoughtType, { thought: thought as ThoughtType, count, lastUsed });
      continue;
    }

    merged.set(thought as ThoughtType, {
      thought: thought as ThoughtType,
      count: existing.count + count,
      lastUsed: Math.max(existing.lastUsed, lastUsed),
    });
  }

  return Array.from(merged.values());
}

/**
 * Manages thought preferences for contacts
 */
export class ThoughtPreferenceManager {
  constructor(private store: IndexedDBStore) {}

  /**
   * Record a thought selection for a contact
   */
  async recordThoughtSelection(contactKey: ContactKey, thought: ThoughtType): Promise<void> {
    const contactKeyStr = contactKeyToString(contactKey);
    await this.store.updateThoughtPreference(contactKey, (existing) => {
      const now = Date.now();

      let thoughtHistory: ThoughtHistoryEntry[];
      let defaultThought: ThoughtType | null;

      if (existing) {
        thoughtHistory = normalizeThoughtHistory(
          (existing as unknown as { thoughtHistory?: unknown }).thoughtHistory
        );
        defaultThought = existing.defaultThought;

        const entryIndex = thoughtHistory.findIndex((e) => e.thought === thought);

        if (entryIndex >= 0) {
          thoughtHistory[entryIndex] = {
            ...thoughtHistory[entryIndex],
            count: thoughtHistory[entryIndex].count + 1,
            lastUsed: now,
          };
        } else {
          thoughtHistory.push({
            thought,
            count: 1,
            lastUsed: now,
          });
        }
      } else {
        thoughtHistory = [{ thought, count: 1, lastUsed: now }];
        defaultThought = null;
      }

      const topEntry = thoughtHistory
        .filter((e) => e.count >= DEFAULT_THOUGHT_THRESHOLD)
        .reduce<ThoughtHistoryEntry | null>((top, entry) => {
          if (!top) return entry;
          if (entry.count > top.count) return entry;
          if (entry.count === top.count && entry.lastUsed > top.lastUsed) return entry;
          return top;
        }, null);

      defaultThought = topEntry ? topEntry.thought : defaultThought;

      return {
        contactKeyStr: existing?.contactKeyStr ?? contactKeyStr,
        thoughtHistory,
        defaultThought,
        updatedAt: now,
      } satisfies ThoughtPreference;
    });
  }

  /**
   * Get the thought preference for a contact
   */
  async getPreference(contactKey: ContactKey): Promise<ThoughtPreference | null> {
    return this.store.getThoughtPreference(contactKey);
  }

  /**
   * Get recommended thoughts for a contact, ordered by usage history
   */
  async getRecommendedThoughts(contactKey: ContactKey): Promise<ThoughtType[]> {
    const allThoughts: ThoughtType[] = [...THOUGHT_TYPES];
    const preference = await this.store.getThoughtPreference(contactKey);

    if (!preference || preference.thoughtHistory.length === 0) {
      return allThoughts;
    }

    const sortedHistory = [...preference.thoughtHistory].sort((a, b) => b.count - a.count);
    const usedThoughts = sortedHistory.map((e) => e.thought);
    const unusedThoughts = allThoughts.filter((t) => !usedThoughts.includes(t));

    return [...usedThoughts, ...unusedThoughts];
  }

  /**
   * Reset thought preferences for a contact
   */
  async resetPreference(contactKey: ContactKey): Promise<void> {
    await this.store.deleteThoughtPreference(contactKey);
  }

  /**
   * Export all thought preferences
   */
  async exportPreferences(): Promise<ThoughtPreference[]> {
    return this.store.getAllThoughtPreferences();
  }
}
