import type { ReplyStyle } from './llm';

/**
 * Style history entry tracking usage of a specific reply style
 */
export interface StyleHistoryEntry {
  /** The reply style type */
  style: ReplyStyle;
  /** Number of times this style has been selected */
  count: number;
  /** Timestamp of last usage */
  lastUsed: number;
}

/**
 * Style preference for a specific contact
 */
export interface StylePreference {
  /** Contact identifier string (used as primary key) */
  contactKeyStr: string;
  /** History of style usage */
  styleHistory: StyleHistoryEntry[];
  /** Default style (set when a style is selected 3+ times) */
  defaultStyle: ReplyStyle | null;
  /** Last update timestamp */
  updatedAt: number;
}
