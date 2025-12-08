import type { ReplyCandidate } from '@social-copilot/core';

interface CopilotUIOptions {
  onSelect: (candidate: ReplyCandidate) => void;
  onRefresh: () => void;
}

/**
 * Copilot 悬浮 UI 组件
 */
export class CopilotUI {
  private container: HTMLElement | null = null;
  private options: CopilotUIOptions;
  private candidates: ReplyCandidate[] = [];
  private isLoading = false;
  private error: string | null = null;
  private notification: string | null = null;
  private position: { top: number; left: number } | null = null;
  private dragStart: { x: number; y: number; top: number; left: number } | null = null;
  private readonly positionStorageKey = `sc-panel-pos-${location.host}`;
  
  // 事件处理器引用，用于清理
  private closeHandler: (() => void) | null = null;
  private refreshHandler: (() => void) | null = null;
  private candidateClickHandler: ((e: Event) => void) | null = null;

  constructor(options: CopilotUIOptions) {
    this.options = options;
  }

  mount() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'social-copilot-root';
    this.container.innerHTML = this.render();
    document.body.appendChild(this.container);
    this.applyPosition();
    void this.restorePosition();

    this.bindEvents();
  }

  unmount() {
    this.unbindEvents();
    this.detachDragListeners();
    this.container?.remove();
    this.container = null;
    this.candidates = [];
  }

  show() {
    if (this.container) {
      this.container.style.display = 'block';
    }
  }

  hide() {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  setLoading(loading: boolean) {
    this.isLoading = loading;
    this.error = null;
    this.update();
  }

  setError(error: string) {
    this.error = error;
    this.isLoading = false;
    this.notification = null;
    this.update();
  }

  setCandidates(candidates: ReplyCandidate[]) {
    this.candidates = candidates;
    this.isLoading = false;
    this.error = null;
    this.update();
    this.show();
  }

  setNotification(message: string) {
    this.notification = message;
    this.update();
    this.show();
  }

  clearNotification() {
    this.notification = null;
    this.update();
  }

  private render(): string {
    return `
      <div class="sc-panel">
        <div class="sc-header">
          <span class="sc-title">💬 Social Copilot</span>
          <span class="sc-shortcut" title="快捷键">Alt+S</span>
          <button class="sc-refresh" title="刷新建议">🔄</button>
          <button class="sc-close" title="关闭 (Esc)">✕</button>
        </div>
        <div class="sc-content">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  private renderContent(): string {
    const notice = this.renderNotification();

    if (this.isLoading) {
      return `${notice}<div class="sc-loading">正在生成建议...</div>`;
    }

    if (this.error) {
      return `${notice}<div class="sc-error">${this.escapeHtml(this.error)}</div>`;
    }

    if (this.candidates.length === 0) {
      return `${notice}<div class="sc-empty">等待新消息...</div>`;
    }

    const candidateList = this.candidates.map((c, i) => `
      <div class="sc-candidate" data-index="${i}">
        <span class="sc-style">${this.getStyleLabel(c.style)}</span>
        <p class="sc-text">${this.escapeHtml(c.text)}</p>
      </div>
    `).join('');

    return `${notice}${candidateList}`;
  }

  private renderNotification(): string {
    if (!this.notification) return '';
    return `<div class="sc-notice">${this.escapeHtml(this.notification)}</div>`;
  }

  private getStyleLabel(style: string): string {
    const labels: Record<string, string> = {
      humorous: '😄 幽默',
      caring: '💗 关心',
      rational: '🧠 理性',
      casual: '😊 随意',
      formal: '📝 正式',
    };
    return labels[style] || style;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private update() {
    const content = this.container?.querySelector('.sc-content');
    if (content) {
      content.innerHTML = this.renderContent();
    }
  }

  private bindEvents() {
    if (!this.container) return;

    const closeBtn = this.container.querySelector('.sc-close');
    const refreshBtn = this.container.querySelector('.sc-refresh');
    const contentEl = this.container.querySelector('.sc-content');

    // 关闭按钮
    this.closeHandler = () => this.hide();
    closeBtn?.addEventListener('click', this.closeHandler);

    // 刷新按钮
    this.refreshHandler = () => this.options.onRefresh();
    refreshBtn?.addEventListener('click', this.refreshHandler);

    // 使用事件委托处理候选项点击，避免重复绑定
    this.candidateClickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      const candidateEl = target.closest('.sc-candidate');
      if (candidateEl) {
        const index = parseInt(candidateEl.getAttribute('data-index') || '0', 10);
        const candidate = this.candidates[index];
        if (candidate) {
          this.options.onSelect(candidate);
        }
      }
    };
    contentEl?.addEventListener('click', this.candidateClickHandler);

    this.bindDragEvents();
  }

  private bindDragEvents() {
    if (!this.container) return;

    const header = this.container.querySelector('.sc-header');
    header?.addEventListener('mousedown', this.handleDragStart);
  }

  private handleDragStart = (event: Event) => {
    if (!this.container) return;
    if (!(event instanceof MouseEvent)) return;
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest('button')) return;

    const rect = this.container.getBoundingClientRect();
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      top: this.position?.top ?? rect.top,
      left: this.position?.left ?? rect.left,
    };

    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);
    event.preventDefault();
  };

  private handleDragMove = (event: MouseEvent) => {
    if (!this.dragStart || !this.container) return;

    const nextLeft = this.dragStart.left + (event.clientX - this.dragStart.x);
    const nextTop = this.dragStart.top + (event.clientY - this.dragStart.y);
    this.position = this.clampPosition(nextLeft, nextTop);
    this.applyPosition();
  };

  private handleDragEnd = () => {
    if (!this.dragStart) return;

    this.detachDragListeners();
    void this.savePosition();
  };

  private detachDragListeners() {
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    this.dragStart = null;
  }

  private clampPosition(left: number, top: number): { top: number; left: number } {
    const margin = 8;
    const rect = this.container?.getBoundingClientRect();
    const width = rect?.width ?? 320;
    const height = rect?.height ?? 240;

    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop),
    };
  }

  private applyPosition() {
    if (!this.container) return;

    if (this.position) {
      this.container.style.left = `${this.position.left}px`;
      this.container.style.top = `${this.position.top}px`;
      this.container.style.right = 'auto';
      this.container.style.bottom = 'auto';
    } else {
      this.container.style.left = 'auto';
      this.container.style.top = 'auto';
      this.container.style.right = '20px';
      this.container.style.bottom = '80px';
    }
  }

  private async restorePosition() {
    try {
      const result = await chrome.storage.local.get(this.positionStorageKey);
      const saved = result[this.positionStorageKey] as { top?: number; left?: number } | undefined;

      if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
        this.position = this.clampPosition(saved.left, saved.top);
      }
    } catch (error) {
      console.warn('[Social Copilot] Failed to restore panel position', error);
    } finally {
      this.applyPosition();
    }
  }

  private async savePosition() {
    if (!this.position) return;

    try {
      await chrome.storage.local.set({
        [this.positionStorageKey]: this.position,
      });
    } catch (error) {
      console.warn('[Social Copilot] Failed to save panel position', error);
    }
  }

  private unbindEvents() {
    if (!this.container) return;

    const closeBtn = this.container.querySelector('.sc-close');
    const refreshBtn = this.container.querySelector('.sc-refresh');
    const contentEl = this.container.querySelector('.sc-content');

    if (this.closeHandler) {
      closeBtn?.removeEventListener('click', this.closeHandler);
      this.closeHandler = null;
    }

    if (this.refreshHandler) {
      refreshBtn?.removeEventListener('click', this.refreshHandler);
      this.refreshHandler = null;
    }

    if (this.candidateClickHandler) {
      contentEl?.removeEventListener('click', this.candidateClickHandler);
      this.candidateClickHandler = null;
    }

    this.container.querySelector('.sc-header')?.removeEventListener('mousedown', this.handleDragStart);
  }
}
