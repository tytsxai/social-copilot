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
});
