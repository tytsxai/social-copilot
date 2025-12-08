import type { ContactKey, ReplyStyle, StylePreference, StyleHistoryEntry } from '../types';
import { contactKeyToString } from '../types/contact';
import type { IndexedDBStore } from '../memory/indexeddb-store';

/** Threshold for setting a default style */
const DEFAULT_STYLE_THRESHOLD = 3;

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
    const existing = await this.store.getStylePreference(contactKey);
    const now = Date.now();

    let styleHistory: StyleHistoryEntry[];
    let defaultStyle: ReplyStyle | null;

    if (existing) {
      styleHistory = [...existing.styleHistory];
      defaultStyle = existing.defaultStyle;

      // Find existing entry for this style
      const entryIndex = styleHistory.findIndex(e => e.style === style);
      
      if (entryIndex >= 0) {
        // Update existing entry
        styleHistory[entryIndex] = {
          ...styleHistory[entryIndex],
          count: styleHistory[entryIndex].count + 1,
          lastUsed: now,
        };
      } else {
        // Add new entry
        styleHistory.push({
          style,
          count: 1,
          lastUsed: now,
        });
      }
    } else {
      // Create new preference
      styleHistory = [{
        style,
        count: 1,
        lastUsed: now,
      }];
      defaultStyle = null;
    }

    // Check if any style should become the default
    const topEntry = styleHistory
      .filter(e => e.count >= DEFAULT_STYLE_THRESHOLD)
      .reduce<StyleHistoryEntry | null>((top, entry) => {
        if (!top) return entry;
        if (entry.count > top.count) return entry;
        if (entry.count === top.count && entry.lastUsed > top.lastUsed) return entry;
        return top;
      }, null);

    defaultStyle = topEntry ? topEntry.style : defaultStyle;

    const preference: StylePreference = {
      contactKeyStr,
      styleHistory,
      defaultStyle,
      updatedAt: now,
    };

    await this.store.saveStylePreference(preference);
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
