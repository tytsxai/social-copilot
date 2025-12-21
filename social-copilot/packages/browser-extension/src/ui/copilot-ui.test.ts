// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi, beforeEach } from 'vitest';
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

describe('CopilotUI drag', () => {
  let ui: CopilotUI | null = null;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
  });

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  test('dragging header updates position styles', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();

    const root = document.getElementById('social-copilot-root') as HTMLElement;
    const header = root.querySelector('.sc-header') as HTMLElement;

    root.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 200,
        width: 320,
        height: 240,
        right: 520,
        bottom: 340,
        x: 200,
        y: 100,
        toJSON: () => {},
      }) as any;

    header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 20, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 70, bubbles: true }));

    expect(root.style.left).toBe('220px');
    expect(root.style.top).toBe('150px');
    expect(root.style.right).toBe('auto');
    expect(root.style.bottom).toBe('auto');
  });

  test('mouseup detaches drag listeners', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();

    const root = document.getElementById('social-copilot-root') as HTMLElement;
    const header = root.querySelector('.sc-header') as HTMLElement;

    root.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 200,
        width: 320,
        height: 240,
        right: 520,
        bottom: 340,
        x: 200,
        y: 100,
        toJSON: () => {},
      }) as any;

    header.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 20, bubbles: true }));

    expect(addSpy).toHaveBeenCalledWith('mousemove', (ui as any).handleDragMove);
    expect(addSpy).toHaveBeenCalledWith('mouseup', (ui as any).handleDragEnd);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 70, bubbles: true }));
    expect(root.style.left).toBe('220px');

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(removeSpy).toHaveBeenCalledWith('mousemove', (ui as any).handleDragMove);
    expect(removeSpy).toHaveBeenCalledWith('mouseup', (ui as any).handleDragEnd);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 90, bubbles: true }));
    expect(root.style.left).toBe('220px');
    expect((ui as any).dragStart).toBeNull();
  });
});

describe('CopilotUI refresh', () => {
  let ui: CopilotUI | null = null;

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
  });

  test('clicking refresh button triggers onRefresh callback', () => {
    const onRefresh = vi.fn();
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh,
    });

    ui.mount();

    const refreshBtn = document.querySelector('.sc-refresh') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();

    refreshBtn?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('CopilotUI privacy prompt', () => {
  let ui: CopilotUI | null = null;

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
  });

  test('setPrivacyPrompt then clicking ack triggers onPrivacyAcknowledge', () => {
    const onPrivacyAcknowledge = vi.fn();
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
      onPrivacyAcknowledge,
    });

    ui.mount();
    ui.setPrivacyPrompt('test privacy prompt');

    const ackBtn = document.querySelector('.sc-privacy-ack') as HTMLButtonElement | null;
    expect(ackBtn).not.toBeNull();

    ackBtn?.click();
    expect(onPrivacyAcknowledge).toHaveBeenCalledTimes(1);
  });
});

describe('CopilotUI candidates', () => {
  let ui: CopilotUI | null = null;

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
  });

  test('clicking a candidate triggers onSelect callback', () => {
    const onSelect = vi.fn();
    ui = new CopilotUI({
      onSelect,
      onRefresh: () => {},
    });

    ui.mount();
    const candidate = { style: 'formal', text: 'hello' } as any;
    ui.setCandidates([candidate]);

    const clickable = document.querySelector('.sc-candidate .sc-text') as HTMLElement | null;
    expect(clickable).not.toBeNull();

    clickable?.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(candidate);
  });
});

describe('CopilotUI mount/unmount', () => {
  let ui: CopilotUI | null = null;

  afterEach(() => {
    ui?.unmount();
    ui = null;
    document.getElementById('social-copilot-root')?.remove();
    document.body.innerHTML = '';
  });

  test('mount creates root DOM node', () => {
    expect(document.getElementById('social-copilot-root')).toBeNull();

    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });

    ui.mount();

    const root = document.getElementById('social-copilot-root');
    expect(root).not.toBeNull();
    expect(document.body.contains(root)).toBe(true);
  });

  test('unmount removes root DOM node', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });

    ui.mount();
    expect(document.getElementById('social-copilot-root')).not.toBeNull();

    ui.unmount();
    expect(document.getElementById('social-copilot-root')).toBeNull();
  });

  test('mount is idempotent (no duplicate roots)', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });

    ui.mount();
    const firstRoot = document.getElementById('social-copilot-root');
    expect(firstRoot).not.toBeNull();

    ui.mount();
    const roots = document.querySelectorAll('#social-copilot-root');
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(firstRoot);
  });
});
