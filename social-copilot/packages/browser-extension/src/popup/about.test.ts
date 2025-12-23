// @vitest-environment jsdom
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('About Page UI', () => {
  let htmlContent: string;

  beforeAll(() => {
    const htmlPath = path.resolve(__dirname, 'index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    document.documentElement.innerHTML = htmlContent;
  });

  test('uses CSS variables for text colors', () => {
    const aboutTab = document.getElementById('about');
    expect(aboutTab).not.toBeNull();

    // Check paragraphs for hardcoded colors
    const paragraphs = aboutTab?.querySelectorAll('p');
    paragraphs?.forEach((p) => {
      const style = p.getAttribute('style') || '';
      expect(style).not.toContain('color: #666');
      expect(style).not.toContain('color: #888');
      expect(style).toMatch(/color: var\(--muted(-2)?\)/);
    });
  });

  test('uses button-stack for button grouping', () => {
    const aboutTab = document.getElementById('about');
    const buttonStacks = aboutTab?.querySelectorAll('.button-stack');
    
    expect(buttonStacks?.length).toBeGreaterThan(0);
    
    buttonStacks?.forEach((stack) => {
      // Check if it contains buttons
      const buttons = stack.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      
      // Check for small text after button stack in the fallback card context
      if (stack.nextElementSibling?.tagName === 'SMALL') {
         const small = stack.nextElementSibling as HTMLElement;
         expect(small.style.display).toBe('block');
         expect(small.style.marginTop).toBe('8px');
      }
    });
  });

  test('defines link styles with underline', () => {
    const styleTag = document.querySelector('style');
    expect(styleTag).not.toBeNull();
    const css = styleTag?.textContent || '';
    
    // Check a tag styles
    // We expect: text-decoration: underline
    // Note: Regex is simple here, might need adjustment if CSS formatting changes
    expect(css).toMatch(/a\s*\{[^}]*text-decoration:\s*underline/);
    expect(css).toMatch(/a:hover\s*\{[^}]*text-decoration:\s*underline/);
    expect(css).toMatch(/a:focus-visible\s*\{[^}]*outline:/);
  });

  test('defines button-stack styles', () => {
    const styleTag = document.querySelector('style');
    const css = styleTag?.textContent || '';
    
    expect(css).toContain('.button-stack {');
    expect(css).toContain('gap: 8px');
    expect(css).toContain('margin-top: 8px');
  });
});
