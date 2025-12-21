import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderStyleStats, getStyleLabel } from './preferences';

const styleArb = fc.constantFrom('humorous', 'caring', 'rational', 'casual', 'formal');
const styleHistoryArb = fc.array(
  fc.record({
    style: styleArb,
    count: fc.integer({ min: 1, max: 50 }),
  }),
  { minLength: 1, maxLength: 5 }
);

describe('renderStyleStats', () => {
  /**
   * **Feature: experience-optimization, Property 4: Preference display completeness**
   * **Validates: Requirements 1.4, 5.1**
   */
  test.each(fc.sample(styleHistoryArb, { numRuns: 50 }).map((history) => [history]))(
    'renders count and label for each style history entry: %#',
    (history) => {
      const html = renderStyleStats({ styleHistory: history });

      for (const entry of history) {
        expect(html).toContain(getStyleLabel(entry.style));
        expect(html).toContain(String(entry.count));
      }
    }
  );

  test('escapes style labels to prevent XSS', () => {
    const style = '<img src=x onerror=alert(1) />';
    const html = renderStyleStats({ styleHistory: [{ style, count: 1 }] });

    // The key security check: < and > are escaped so no HTML tags are created
    expect(html).toContain('&lt;img');
    expect(html).toContain('&gt;');
    expect(html).not.toContain('<img');
    // onerror= is still in the text but harmless since it's not in an actual tag
  });
});
