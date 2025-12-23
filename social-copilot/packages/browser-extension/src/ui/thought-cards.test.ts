// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ThoughtCardsComponent } from './thought-cards';

describe('ThoughtCardsComponent', () => {
  const cards = [
    {
      type: 'empathy',
      label: 'Empathy',
      description: '',
      icon: 'E',
      promptHint: '',
    },
    {
      type: 'solution',
      label: 'Solution',
      description: '',
      icon: 'S',
      promptHint: '',
    },
  ] as const;

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  test('click selects, second click deselects, and updates sessionStorage', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    expect(empathyCard).not.toBeNull();
    expect(empathyCard?.getAttribute('aria-pressed')).toBe('false');

    empathyCard?.click();
    expect(component.getSelectedThought()).toBe('empathy');
    expect(onSelect).toHaveBeenLastCalledWith('empathy');
    expect(sessionStorage.getItem('sc-thought-selection')).toBe('empathy');
    expect(parent.querySelector('[data-type="empathy"]')?.classList.contains('sc-thought-card--active')).toBe(true);
    expect(parent.querySelector('[data-type="empathy"]')?.getAttribute('aria-pressed')).toBe('true');

    const empathyCardAfterRender = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    expect(empathyCardAfterRender).not.toBeNull();
    empathyCardAfterRender?.click();
    expect(component.getSelectedThought()).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(sessionStorage.getItem('sc-thought-selection')).toBeNull();
    expect(parent.querySelector('.sc-thought-card--active')).toBeNull();
    expect(parent.querySelector('[data-type="empathy"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('restores selection from sessionStorage on construction', () => {
    sessionStorage.setItem('sc-thought-selection', 'solution');

    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    expect(component.getSelectedThought()).toBe('solution');
    expect(parent.querySelector('[data-type="solution"]')?.classList.contains('sc-thought-card--active')).toBe(true);
    expect(parent.querySelector('[data-type="solution"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('ignores invalid sessionStorage selection value', () => {
    sessionStorage.setItem('sc-thought-selection', 'not-a-thought-type');

    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect: () => {} });
    component.setCards(cards as any);
    component.render(parent);

    expect(component.getSelectedThought()).toBeNull();
    expect(parent.querySelector('.sc-thought-card--active')).toBeNull();
  });

  test('renders at most 6 cards when given 10', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const manyCards = Array.from({ length: 10 }, (_, index) => ({
      type: `type-${index}`,
      label: `Label ${index}`,
      description: '',
      icon: `${index}`,
      promptHint: '',
    }));

    const component = new ThoughtCardsComponent({ onSelect: () => {} });
    component.setCards(manyCards as any);
    component.render(parent);

    expect(parent.querySelectorAll('.sc-thought-card')).toHaveLength(6);
    expect(parent.querySelector('[data-type="type-0"]')).not.toBeNull();
    expect(parent.querySelector('[data-type="type-5"]')).not.toBeNull();
    expect(parent.querySelector('[data-type="type-6"]')).toBeNull();
  });

  test('removes container when cards are empty', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect: () => {} });
    component.setCards(cards as any);
    component.render(parent);

    expect(parent.querySelector('.sc-thought-cards')).not.toBeNull();

    component.setCards([]);
    expect(parent.querySelector('.sc-thought-cards')).toBeNull();
  });

  test('pressing Enter selects the card', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    expect(empathyCard?.getAttribute('tabindex')).toBe('0');
    expect(empathyCard?.getAttribute('role')).toBe('button');

    empathyCard?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(component.getSelectedThought()).toBe('empathy');
    expect(onSelect).toHaveBeenLastCalledWith('empathy');
  });

  test('pressing Space selects the card and prevents default', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    empathyCard?.dispatchEvent(event);

    expect(component.getSelectedThought()).toBe('empathy');
    expect(onSelect).toHaveBeenLastCalledWith('empathy');
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  test('other keys do not select the card', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    empathyCard?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(component.getSelectedThought()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('clicking card after selection triggers update and recreates container', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    // Select a card
    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    empathyCard?.click();
    expect(component.getSelectedThought()).toBe('empathy');

    // Switch to another card - this triggers update() which recreates container
    const solutionCard = parent.querySelector('[data-type="solution"]') as HTMLElement | null;
    solutionCard?.click();
    expect(component.getSelectedThought()).toBe('solution');
    expect(onSelect).toHaveBeenLastCalledWith('solution');
    expect(parent.querySelector('[data-type="solution"]')?.classList.contains('sc-thought-card--active')).toBe(true);
  });

  test('setCards resets selection when selected thought is no longer available', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    // Select empathy
    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    empathyCard?.click();
    expect(component.getSelectedThought()).toBe('empathy');

    // Set new cards without empathy
    const newCards = [
      {
        type: 'humor',
        label: 'Humor',
        description: '',
        icon: 'H',
        promptHint: '',
      },
    ];
    component.setCards(newCards as any);

    // Selection should be reset
    expect(component.getSelectedThought()).toBeNull();
    expect(sessionStorage.getItem('sc-thought-selection')).toBeNull();
  });

  test('setCards preserves selection when cards list is empty (no recommendations)', () => {
    const onSelect = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect });
    component.setCards(cards as any);
    component.render(parent);

    // Select empathy
    const empathyCard = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    empathyCard?.click();
    expect(component.getSelectedThought()).toBe('empathy');

    // Set empty cards (represents "no recommendations")
    component.setCards([]);

    // Selection should be preserved
    expect(component.getSelectedThought()).toBe('empathy');
    expect(sessionStorage.getItem('sc-thought-selection')).toBe('empathy');
  });

  test('cancelPendingRequest aborts the current request', () => {
    const component = new ThoughtCardsComponent({ onSelect: () => {} });

    const controller = component.createAbortController();
    const abortSpy = vi.spyOn(controller, 'abort');

    component.cancelPendingRequest();

    expect(abortSpy).toHaveBeenCalled();
  });

  test('createAbortController cancels previous controller', () => {
    const component = new ThoughtCardsComponent({ onSelect: () => {} });

    const controller1 = component.createAbortController();
    const abortSpy1 = vi.spyOn(controller1, 'abort');

    const controller2 = component.createAbortController();

    expect(abortSpy1).toHaveBeenCalled();
    expect(controller2).not.toBe(controller1);
  });

  test('destroy cleans up resources and removes container', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const component = new ThoughtCardsComponent({ onSelect: () => {} });
    component.setCards(cards as any);
    component.render(parent);

    const controller = component.createAbortController();
    const abortSpy = vi.spyOn(controller, 'abort');

    expect(parent.querySelector('.sc-thought-cards')).not.toBeNull();

    component.destroy();

    expect(abortSpy).toHaveBeenCalled();
    expect(parent.querySelector('.sc-thought-cards')).toBeNull();
  });
});
