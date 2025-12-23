import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Popup UI States', () => {
  const htmlPath = resolve(__dirname, 'index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');

  test('should have unified scrollbar styles', () => {
    expect(htmlContent).toContain('::-webkit-scrollbar');
    expect(htmlContent).toContain('::-webkit-scrollbar-thumb');
    expect(htmlContent).toContain('::-webkit-scrollbar-track');
  });

  test('should have focus-visible styles', () => {
    expect(htmlContent).toContain(':focus-visible');
    expect(htmlContent).toContain('outline: 2px solid var(--primary)');
  });

  test('should have tab interaction states', () => {
    expect(htmlContent).toContain('.tab:hover');
    expect(htmlContent).toContain('.tab:active');
    expect(htmlContent).toContain('.tab:focus-visible');
  });

  test('should have standardized button states', () => {
    expect(htmlContent).toContain('button.primary:hover');
    expect(htmlContent).toContain('button.primary:active');
    expect(htmlContent).toContain('button.secondary:hover');
    expect(htmlContent).toContain('button.secondary:active');
  });

  test('should have standardized form input focus-visible states', () => {
    expect(htmlContent).toContain('.form-group input:focus-visible');
    expect(htmlContent).toContain('.form-group select:focus-visible');
    expect(htmlContent).toContain('.form-group textarea:focus-visible');
  });

  test('should have checkbox focus-visible states', () => {
    expect(htmlContent).toContain('input[type="checkbox"]:focus-visible');
  });

  test('should have range focus-visible states', () => {
    expect(htmlContent).toContain('input[type="range"]:focus-visible');
  });
});
