import type { ContactKey, ReplyStyle, StylePreference, StyleHistoryEntry } from '../types';
import { contactKeyToString } from '../types/contact';
import type { IndexedDBStore } from '../memory/indexeddb-store';

/** Threshold for setting a default style */
const DEFAULT_STYLE_THRESHOLD = 3;
const ALL_STYLES: ReplyStyle[] = ['humorous', 'caring', 'rational', 'casual', 'formal'];
const STYLE_SET: ReadonlySet<ReplyStyle> = new Set(ALL_STYLES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStyleHistory(raw: unknown): StyleHistoryEntry[] {
  if (!Array.isArray(raw)) return [];

  const merged = new Map<ReplyStyle, StyleHistoryEntry>();

  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const style = item.style;
    if (!STYLE_SET.has(style as ReplyStyle)) continue;

    const countRaw = item.count;
    const lastUsedRaw = item.lastUsed;
    if (typeof countRaw !== 'number' || !Number.isFinite(countRaw)) continue;
    if (typeof lastUsedRaw !== 'number' || !Number.isFinite(lastUsedRaw)) continue;

    const count = Math.floor(countRaw);
    const lastUsed = Math.floor(lastUsedRaw);
    if (count <= 0 || lastUsed < 0) continue;

    const existing = merged.get(style as ReplyStyle);
    if (!existing) {
      merged.set(style as ReplyStyle, { style: style as ReplyStyle, count, lastUsed });
      continue;
    }

    merged.set(style as ReplyStyle, {
      style: style as ReplyStyle,
      count: existing.count + count,
      lastUsed: Math.max(existing.lastUsed, lastUsed),
    });
  }

  return Array.from(merged.values());
}

/**
 * Manages style preferences for contacts
 */
export class StylePreferenceManager {
  constructor(private store: IndexedDBStore) {}

  /**
   * Record a style selection for a contact
   * Updates the style history and potentially sets a default style
   */
  async recordStyleSelection(contactKey: ContactKey, style: ReplyStyle): Promise<void> {
    const contactKeyStr = contactKeyToString(contactKey);
    await this.store.updateStylePreference(contactKey, (existing) => {
      const now = Date.now();

      let styleHistory: StyleHistoryEntry[];
      let defaultStyle: ReplyStyle | null;

      if (existing) {
        styleHistory = normalizeStyleHistory((existing as unknown as { styleHistory?: unknown }).styleHistory);
        defaultStyle = existing.defaultStyle;

        const entryIndex = styleHistory.findIndex((e) => e.style === style);

        if (entryIndex >= 0) {
          styleHistory[entryIndex] = {
            ...styleHistory[entryIndex],
            count: styleHistory[entryIndex].count + 1,
            lastUsed: now,
          };
        } else {
          styleHistory.push({
            style,
            count: 1,
            lastUsed: now,
          });
        }
      } else {
        styleHistory = [
          {
            style,
            count: 1,
            lastUsed: now,
          },
        ];
        defaultStyle = null;
      }

      const topEntry = styleHistory
        .filter((e) => e.count >= DEFAULT_STYLE_THRESHOLD)
        .reduce<StyleHistoryEntry | null>((top, entry) => {
          if (!top) return entry;
          if (entry.count > top.count) return entry;
          if (entry.count === top.count && entry.lastUsed > top.lastUsed) return entry;
          return top;
        }, null);

      defaultStyle = topEntry ? topEntry.style : defaultStyle;

      return {
        contactKeyStr: existing?.contactKeyStr ?? contactKeyStr,
        styleHistory,
        defaultStyle,
        updatedAt: now,
      } satisfies StylePreference;
    });
  }

  /**
   * Get the style preference for a contact
   */
  async getPreference(contactKey: ContactKey): Promise<StylePreference | null> {
    return this.store.getStylePreference(contactKey);
  }

  /**
   * Get recommended styles for a contact, ordered by usage history
   * Returns all available styles, with previously used styles first (by count descending)
   */
  async getRecommendedStyles(contactKey: ContactKey): Promise<ReplyStyle[]> {
    const allStyles: ReplyStyle[] = ['humorous', 'caring', 'rational', 'casual', 'formal'];
    const preference = await this.store.getStylePreference(contactKey);

    if (!preference || preference.styleHistory.length === 0) {
      return allStyles;
    }

    // Sort history by count descending
    const sortedHistory = [...preference.styleHistory].sort((a, b) => b.count - a.count);
    const usedStyles = sortedHistory.map(e => e.style);
    
    // Add unused styles at the end
    const unusedStyles = allStyles.filter(s => !usedStyles.includes(s));
    
    return [...usedStyles, ...unusedStyles];
  }

  /**
   * Reset style preferences for a contact
   * Clears style history and default style
   */
  async resetPreference(contactKey: ContactKey): Promise<void> {
    await this.store.deleteStylePreference(contactKey);
  }

  /**
   * Export all style preferences
   */
  async exportPreferences(): Promise<StylePreference[]> {
    return this.store.getAllStylePreferences();
  }
}
