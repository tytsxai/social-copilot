// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { CopilotUI } from './copilot-ui';

describe('CopilotUI XSS', () => {
  let ui: CopilotUI | null = null;

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
  });

  test('escapes candidate style label before rendering to innerHTML', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });

    ui.mount();
    ui.setCandidates([
      {
        style: '<img src=x onerror=alert(1) />' as any,
        text: 'hello',
      } as any,
    ]);

    const styleEl = document.querySelector('.sc-style') as HTMLElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.querySelector('img')).toBeNull();
    expect(styleEl?.innerHTML).toContain('&lt;img');
    expect(styleEl?.textContent).toContain('<img');
  });

  test('escapes candidate text before rendering to innerHTML', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });

    ui.mount();
    ui.setCandidates([
      {
        style: 'formal' as any,
        text: '<svg onload=alert(1)>x</svg>',
      } as any,
    ]);

    const textEl = document.querySelector('.sc-text') as HTMLElement | null;
    expect(textEl).not.toBeNull();
    expect(textEl?.querySelector('svg')).toBeNull();
    expect(textEl?.innerHTML).toContain('&lt;svg');
  });
});

