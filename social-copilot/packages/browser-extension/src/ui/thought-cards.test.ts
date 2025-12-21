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

    empathyCard?.click();
    expect(component.getSelectedThought()).toBe('empathy');
    expect(onSelect).toHaveBeenLastCalledWith('empathy');
    expect(sessionStorage.getItem('sc-thought-selection')).toBe('empathy');
    expect(parent.querySelector('[data-type="empathy"]')?.classList.contains('sc-thought-card--active')).toBe(true);

    const empathyCardAfterRender = parent.querySelector('[data-type="empathy"]') as HTMLElement | null;
    expect(empathyCardAfterRender).not.toBeNull();
    empathyCardAfterRender?.click();
    expect(component.getSelectedThought()).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(sessionStorage.getItem('sc-thought-selection')).toBeNull();
    expect(parent.querySelector('.sc-thought-card--active')).toBeNull();
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
});
