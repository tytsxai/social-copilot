import type { ThoughtCard, ThoughtType } from '@social-copilot/core';

export interface ThoughtCardsOptions {
  onSelect: (thought: ThoughtType | null) => void;
}

/**
 * 思路卡片 UI 组件
 * 在面板顶部展示可点击的思路选项
 */
export class ThoughtCardsComponent {
  private container: HTMLElement | null = null;
  private cards: ThoughtCard[] = [];
  private selectedThought: ThoughtType | null = null;
  private options: ThoughtCardsOptions;
  private abortController: AbortController | null = null;
  private cardClickHandler: ((e: Event) => void) | null = null;

  constructor(options: ThoughtCardsOptions) {
    this.options = options;
    this.restoreSelection();
  }

  /**
   * 渲染思路卡片到指定容器
   */
  render(parentElement: HTMLElement): void {
    if (this.container) {
      this.container.remove();
    }

    this.container = document.createElement('div');
    this.container.className = 'sc-thought-cards';
    this.container.innerHTML = this.renderCards();
    parentElement.insertBefore(this.container, parentElement.firstChild);

    this.bindEvents();
  }

  /**
   * 更新可用的思路卡片
   */
  setCards(cards: ThoughtCard[]): void {
    this.cards = cards;
    const availableTypes = new Set(cards.map((card) => card.type));

    // 如果当前选中的思路不再可用，则重置选择
    // 注意：当 cards 为空时，代表“暂无推荐”，不应清除用户的历史选择。
    if (availableTypes.size > 0 && this.selectedThought && !availableTypes.has(this.selectedThought)) {
      this.selectedThought = null;
      this.saveSelection();
    }

    this.update();
  }

  /**
   * 获取当前选中的思路类型
   */
  getSelectedThought(): ThoughtType | null {
    return this.selectedThought;
  }

  /**
   * 取消当前进行中的请求
   */
  cancelPendingRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 创建新的 AbortController 用于请求
   */
  createAbortController(): AbortController {
    this.cancelPendingRequest();
    this.abortController = new AbortController();
    return this.abortController;
  }

  /**
   * 清理组件
   */
  destroy(): void {
    this.cancelPendingRequest();
    this.unbindEvents();
    this.container?.remove();
    this.container = null;
  }

  private renderCards(): string {
    if (this.cards.length === 0) {
      return '';
    }

    const cardsHtml = this.cards.map((card) => {
      const isActive = this.selectedThought === card.type;
      const activeClass = isActive ? 'sc-thought-card--active' : '';
      return `
        <div class="sc-thought-card ${activeClass}" data-type="${this.escapeHtml(card.type)}">
          <span class="sc-thought-icon">${this.escapeHtml(card.icon)}</span>
          <span class="sc-thought-label">${this.escapeHtml(card.label)}</span>
        </div>
      `;
    }).join('');

    return cardsHtml;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private update(): void {
    if (!this.container) return;
    this.container.innerHTML = this.renderCards();
  }

  private bindEvents(): void {
    if (!this.container) return;

    this.cardClickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      const cardEl = target.closest('.sc-thought-card');
      if (!cardEl) return;

      const type = cardEl.getAttribute('data-type') as ThoughtType;
      this.handleCardClick(type);
    };

    this.container.addEventListener('click', this.cardClickHandler);
  }

  private unbindEvents(): void {
    if (this.container && this.cardClickHandler) {
      this.container.removeEventListener('click', this.cardClickHandler);
      this.cardClickHandler = null;
    }
  }

  private handleCardClick(type: ThoughtType): void {
    // 取消待处理的请求
    this.cancelPendingRequest();

    // 切换选中状态
    if (this.selectedThought === type) {
      this.selectedThought = null;
    } else {
      this.selectedThought = type;
    }

    // 保存选择到 sessionStorage
    this.saveSelection();

    // 更新 UI
    this.update();

    // 通知外部
    this.options.onSelect(this.selectedThought);
  }

  private saveSelection(): void {
    if (this.selectedThought) {
      sessionStorage.setItem('sc-thought-selection', this.selectedThought);
    } else {
      sessionStorage.removeItem('sc-thought-selection');
    }
  }

  private restoreSelection(): void {
    const saved = sessionStorage.getItem('sc-thought-selection');
    if (saved && ['empathy', 'solution', 'humor', 'neutral'].includes(saved)) {
      this.selectedThought = saved as ThoughtType;
    }
  }
}
