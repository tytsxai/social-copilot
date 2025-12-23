import { describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';

describe('Popup Accessibility', () => {
  const htmlPath = resolve(__dirname, 'index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(htmlContent);
    document = dom.window.document;
  });

  test('style-options should be focusable via tabindex', () => {
    const styleOptions = document.querySelectorAll('.style-option');
    expect(styleOptions.length).toBeGreaterThan(0);
    styleOptions.forEach(option => {
      expect(option.getAttribute('tabindex')).toBe('0');
    });
  });

  test('all buttons should have cursor: pointer', () => {
    // We check the styles in the HTML content since JSDOM doesn't fully process CSS
    expect(htmlContent).toMatch(/\.tab\s*{[^}]*cursor:\s*pointer/);
    expect(htmlContent).toMatch(/button\.primary\s*{[^}]*cursor:\s*pointer/);
    expect(htmlContent).toMatch(/button\.secondary\s*{[^}]*cursor:\s*pointer/);
    expect(htmlContent).toMatch(/\.reset-pref-btn,\s*\.clear-memory-btn,\s*\.clear-contact-btn\s*{[^}]*cursor:\s*pointer/);
  });

  test('contact-item should NOT have cursor: pointer', () => {
    // Check that .contact-item style block does not contain cursor: pointer
    const contactItemStyleMatch = htmlContent.match(/\.contact-item\s*{([^}]*)}/);
    if (contactItemStyleMatch) {
      expect(contactItemStyleMatch[1]).not.toContain('cursor: pointer');
    }
  });

  test('focus-visible styles should use the specified outline', () => {
    expect(htmlContent).toContain('outline: 2px solid var(--primary)');
    expect(htmlContent).toContain('outline-offset: 2px');
  });

  test('form controls should have explicit focus-visible outline', () => {
    expect(htmlContent).toMatch(/\.form-group\s+input:focus-visible,[^}]*outline:\s*2px\s+solid\s+var\(--primary\)/);
    expect(htmlContent).toMatch(/\.form-group\s+input:focus-visible,[^}]*outline-offset:\s*2px/);
  });

  test('style-option should have focus-visible outline', () => {
    expect(htmlContent).toMatch(/\.style-option:focus-visible\s*{[^}]*outline:\s*2px\s+solid\s+var\(--primary\)/);
  });
});
