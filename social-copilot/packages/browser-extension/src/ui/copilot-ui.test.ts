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

  test('pressing Enter on a candidate triggers onSelect callback', () => {
    const onSelect = vi.fn();
    ui = new CopilotUI({
      onSelect,
      onRefresh: () => {},
    });

    ui.mount();
    const candidate = { style: 'formal', text: 'hello' } as any;
    ui.setCandidates([candidate]);

    const clickable = document.querySelector('.sc-candidate') as HTMLElement | null;
    expect(clickable).not.toBeNull();
    expect(clickable?.getAttribute('tabindex')).toBe('0');
    expect(clickable?.getAttribute('role')).toBe('button');

    clickable?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(candidate);
  });

  test('pressing Space on a candidate triggers onSelect callback and prevents default', () => {
    const onSelect = vi.fn();
    ui = new CopilotUI({
      onSelect,
      onRefresh: () => {},
    });

    ui.mount();
    const candidate = { style: 'formal', text: 'hello' } as any;
    ui.setCandidates([candidate]);

    const clickable = document.querySelector('.sc-candidate') as HTMLElement | null;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    clickable?.dispatchEvent(event);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(candidate);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  test('other keys do not trigger onSelect', () => {
    const onSelect = vi.fn();
    ui = new CopilotUI({
      onSelect,
      onRefresh: () => {},
    });

    ui.mount();
    ui.setCandidates([{ style: 'formal', text: 'hello' } as any]);

    const clickable = document.querySelector('.sc-candidate') as HTMLElement | null;
    clickable?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
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

describe('CopilotUI States & Storage', () => {
  let ui: CopilotUI | null = null;

  beforeEach(() => {
    // Mock chrome storage
    (global as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        sync: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  afterEach(() => {
    ui?.unmount();
    ui = null;
    delete (global as any).chrome;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  test('setLoading/setError/setNotification/clearNotification updates UI', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();

    ui.setLoading(true);
    expect(document.querySelector('.sc-loading')).not.toBeNull();

    ui.setError('test error');
    expect(document.querySelector('.sc-error')?.textContent).toBe('test error');
    expect(document.querySelector('.sc-loading')).toBeNull();

    ui.setNotification('test notification');
    expect(document.querySelector('.sc-notice')?.textContent).toBe('test notification');

    ui.clearNotification();
    expect(document.querySelector('.sc-notice')).toBeNull();
  });

  test('show/hide toggles display', () => {
    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();
    const root = document.getElementById('social-copilot-root') as HTMLElement;

    ui.hide();
    expect(root.style.display).toBe('none');

    ui.show();
    expect(root.style.display).toBe('block');
  });

  test('restores position from chrome storage', async () => {
    const key = `sc-panel-pos-${location.host}`;
    (chrome.storage.local.get as any).mockResolvedValue({
      [key]: { top: 100, left: 100 },
    });

    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();

    // Wait for restorePosition async call
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = document.getElementById('social-copilot-root') as HTMLElement;
    expect(root.style.top).toBe('100px');
    expect(root.style.left).toBe('100px');
  });

  test('saves position to chrome storage after drag', async () => {
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
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const callArgs = (chrome.storage.local.set as any).mock.calls[0][0];
    const key = `sc-panel-pos-${location.host}`;
    expect(callArgs[key]).toEqual({ left: 220, top: 150 });
  });

  test('handles storage error gracefully', async () => {
    (chrome.storage.local.get as any).mockRejectedValue(new Error('storage error'));

    ui = new CopilotUI({
      onSelect: () => {},
      onRefresh: () => {},
    });
    ui.mount();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = document.getElementById('social-copilot-root') as HTMLElement;
    // Should still apply default position
    expect(root.style.right).toBe('20px');
    expect(root.style.bottom).toBe('80px');
  });
});
