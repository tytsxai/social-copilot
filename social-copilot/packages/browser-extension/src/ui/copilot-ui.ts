import type { ReplyCandidate, ThoughtCard, ThoughtType } from '@social-copilot/core';
import { escapeHtml } from '../utils/escape-html';
import { debugWarn } from '../utils/debug';
import { ThoughtCardsComponent } from './thought-cards';

interface CopilotUIOptions {
  onSelect: (candidate: ReplyCandidate) => void;
  onRefresh: () => void;
  onThoughtSelect?: (thought: ThoughtType | null) => void;
  onPrivacyAcknowledge?: () => void;
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
  private privacyPrompt: string | null = null;
  private position: { top: number; left: number } | null = null;
  private dragStart: { x: number; y: number; top: number; left: number } | null = null;
  private readonly positionStorageKey = `sc-panel-pos-${location.host}`;

  // 事件处理器引用，用于清理
  private closeHandler: (() => void) | null = null;
  private refreshHandler: (() => void) | null = null;
  private candidateClickHandler: ((e: Event) => void) | null = null;

  // 思路卡片组件
  private thoughtCards: ThoughtCardsComponent;

  constructor(options: CopilotUIOptions) {
    this.options = options;
    this.thoughtCards = new ThoughtCardsComponent({
      onSelect: (thought) => {
        this.options.onThoughtSelect?.(thought);
      },
    });
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

    // 渲染思路卡片
    const contentEl = this.container.querySelector('.sc-content');
    if (contentEl) {
      this.thoughtCards.render(contentEl as HTMLElement);
    }
  }

  unmount() {
    this.unbindEvents();
    this.detachDragListeners();
    this.thoughtCards.destroy();
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
    this.privacyPrompt = null;
    this.update();
  }

  setError(error: string) {
    this.error = error;
    this.isLoading = false;
    this.privacyPrompt = null;
    this.notification = null;
    this.update();
  }

  setCandidates(candidates: ReplyCandidate[]) {
    this.candidates = candidates;
    this.isLoading = false;
    this.error = null;
    this.privacyPrompt = null;
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

  setPrivacyPrompt(message: string) {
    this.privacyPrompt = message;
    this.isLoading = false;
    this.error = null;
    this.notification = null;
    this.candidates = [];
    this.thoughtCards.setCards([]);
    this.update();
    this.show();
  }

  clearPrivacyPrompt() {
    if (!this.privacyPrompt) return;
    this.privacyPrompt = null;
    this.update();
  }

  setThoughtCards(cards: ThoughtCard[]) {
    this.thoughtCards.setCards(cards);
  }

  getSelectedThought(): ThoughtType | null {
    return this.thoughtCards.getSelectedThought();
  }

  getThoughtAbortController(): AbortController {
    return this.thoughtCards.createAbortController();
  }

  private render(): string {
    return `
      <style>
        #social-copilot-root {
          position: fixed;
          z-index: 2147483647;
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji",
            "Segoe UI Emoji", "Segoe UI Symbol";
          color: #0f172a;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
          line-height: 1.45;
        }

        #social-copilot-root,
        #social-copilot-root * {
          box-sizing: border-box;
        }

        #social-copilot-root .sc-panel {
          width: 320px;
          max-width: min(92vw, 360px);
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid rgba(15, 23, 42, 0.12);
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
          backdrop-filter: blur(10px);
        }

        #social-copilot-root .sc-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 10px;
          background: linear-gradient(135deg, rgba(91, 94, 246, 0.95) 0%, rgba(124, 58, 237, 0.92) 100%);
          color: rgba(255, 255, 255, 0.98);
          cursor: grab;
          user-select: none;
        }

        #social-copilot-root .sc-header:active {
          cursor: grabbing;
        }

        #social-copilot-root .sc-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 750;
          letter-spacing: 0.2px;
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        #social-copilot-root .sc-shortcut {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.18);
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: rgba(255, 255, 255, 0.92);
        }

        #social-copilot-root .sc-header button {
          appearance: none;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.95);
          width: 30px;
          height: 30px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.12s ease, transform 0.12s ease, opacity 0.12s ease;
        }

        #social-copilot-root .sc-header button:hover {
          background: rgba(255, 255, 255, 0.18);
        }

        #social-copilot-root .sc-header button:active {
          transform: translateY(0.5px);
        }

        #social-copilot-root .sc-content {
          padding: 10px;
          max-height: 360px;
          overflow: auto;
        }

        #social-copilot-root .sc-content::-webkit-scrollbar {
          width: 10px;
        }

        #social-copilot-root .sc-content::-webkit-scrollbar-thumb {
          background: rgba(15, 23, 42, 0.18);
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.85);
        }

        #social-copilot-root .sc-notice {
          padding: 10px 10px;
          border-radius: 12px;
          background: rgba(59, 130, 246, 0.10);
          border: 1px solid rgba(59, 130, 246, 0.20);
          color: #1e3a8a;
          font-size: 12px;
          margin-bottom: 10px;
          line-height: 1.35;
        }

        #social-copilot-root .sc-loading,
        #social-copilot-root .sc-empty {
          padding: 10px 10px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.03);
          border: 1px solid rgba(15, 23, 42, 0.10);
          color: rgba(15, 23, 42, 0.70);
          font-size: 12.5px;
        }

        #social-copilot-root .sc-error {
          padding: 10px 10px;
          border-radius: 12px;
          background: rgba(239, 68, 68, 0.10);
          border: 1px solid rgba(239, 68, 68, 0.22);
          color: #7f1d1d;
          font-size: 12.5px;
          line-height: 1.35;
        }

        #social-copilot-root .sc-candidate {
          padding: 10px 10px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.10);
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
          margin-bottom: 10px;
        }

        #social-copilot-root .sc-candidate:hover {
          background: rgba(91, 94, 246, 0.07);
          border-color: rgba(91, 94, 246, 0.22);
        }

        #social-copilot-root .sc-candidate:active {
          transform: translateY(0.5px);
        }

        #social-copilot-root .sc-style {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.78);
          background: rgba(91, 94, 246, 0.10);
          border: 1px solid rgba(91, 94, 246, 0.18);
          border-radius: 999px;
          padding: 4px 8px;
          margin-bottom: 8px;
        }

        #social-copilot-root .sc-text {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: rgba(15, 23, 42, 0.88);
          white-space: pre-wrap;
          word-break: break-word;
        }

        #social-copilot-root .sc-thought-cards {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }

        #social-copilot-root .sc-thought-card {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(15, 23, 42, 0.02);
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          font-weight: 700;
          color: rgba(15, 23, 42, 0.82);
          transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
        }

        #social-copilot-root .sc-thought-card:hover {
          background: rgba(91, 94, 246, 0.08);
          border-color: rgba(91, 94, 246, 0.22);
        }

        #social-copilot-root .sc-thought-card:active {
          transform: translateY(0.5px);
        }

        #social-copilot-root .sc-thought-card--active {
          background: linear-gradient(135deg, rgba(91, 94, 246, 0.18) 0%, rgba(124, 58, 237, 0.14) 100%);
          border-color: rgba(91, 94, 246, 0.30);
        }

        #social-copilot-root .sc-privacy {
          padding: 12px;
          border-radius: 14px;
          background: rgba(245, 158, 11, 0.10);
          border: 1px solid rgba(245, 158, 11, 0.22);
          color: rgba(15, 23, 42, 0.90);
        }

        #social-copilot-root .sc-privacy-title {
          font-size: 13px;
          font-weight: 800;
          margin-bottom: 6px;
        }

        #social-copilot-root .sc-privacy-text {
          font-size: 12.5px;
          color: rgba(15, 23, 42, 0.78);
          line-height: 1.5;
          margin-bottom: 10px;
          white-space: pre-wrap;
          word-break: break-word;
        }

        #social-copilot-root .sc-privacy-sub {
          margin-top: 10px;
          font-size: 11.5px;
          color: rgba(15, 23, 42, 0.65);
          line-height: 1.35;
        }

        #social-copilot-root .sc-privacy-ack {
          appearance: none;
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(91, 94, 246, 0.22);
          background: linear-gradient(135deg, rgba(91, 94, 246, 0.95) 0%, rgba(124, 58, 237, 0.92) 100%);
          color: rgba(255, 255, 255, 0.98);
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 16px 30px rgba(91, 94, 246, 0.22);
          transition: transform 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease;
        }

        #social-copilot-root .sc-privacy-ack:hover {
          opacity: 0.96;
          box-shadow: 0 18px 36px rgba(91, 94, 246, 0.28);
        }

        #social-copilot-root .sc-privacy-ack:active {
          transform: translateY(0.5px);
        }
      </style>
      <div class="sc-panel">
        <div class="sc-header">
          <span class="sc-title">💬 Social Copilot</span>
          <span class="sc-shortcut" title="快捷键">Alt+S</span>
          <button class="sc-refresh" type="button" title="刷新建议">↻</button>
          <button class="sc-close" type="button" title="关闭 (Esc)">✕</button>
        </div>
        <div class="sc-content">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  private renderContent(): string {
    const notice = this.renderNotification();

    if (this.privacyPrompt) {
      return `${notice}
        <div class="sc-privacy">
          <div class="sc-privacy-title">隐私提示</div>
          <div class="sc-privacy-text">${escapeHtml(this.privacyPrompt)}</div>
          <button class="sc-privacy-ack" type="button">我已理解，继续</button>
          <div class="sc-privacy-sub">你也可以在扩展设置中随时调整脱敏/匿名化与发送范围。</div>
        </div>`;
    }

    if (this.isLoading) {
      return `${notice}<div class="sc-loading">正在生成建议...</div>`;
    }

    if (this.error) {
      return `${notice}<div class="sc-error">${escapeHtml(this.error)}</div>`;
    }

    if (this.candidates.length === 0) {
      return `${notice}<div class="sc-empty">等待新消息...</div>`;
    }

    const candidateList = this.candidates.map((c, i) => `
      <div class="sc-candidate" data-index="${i}">
        <span class="sc-style">${escapeHtml(this.getStyleLabel(c.style))}</span>
        <p class="sc-text">${escapeHtml(c.text)}</p>
      </div>
    `).join('');

    return `${notice}${candidateList}`;
  }

  private renderNotification(): string {
    if (!this.notification) return '';
    return `<div class="sc-notice">${escapeHtml(this.notification)}</div>`;
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

  private update() {
    const content = this.container?.querySelector('.sc-content');
    if (content) {
      content.innerHTML = this.renderContent();
      // 重新渲染思路卡片
      this.thoughtCards.render(content as HTMLElement);
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
      const ackBtn = target.closest('.sc-privacy-ack');
      if (ackBtn) {
        this.options.onPrivacyAcknowledge?.();
        return;
      }
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
    const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!storage) {
      this.applyPosition();
      return;
    }

    try {
      const result = await storage.get(this.positionStorageKey);
      const saved = result[this.positionStorageKey] as { top?: number; left?: number } | undefined;

      if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
        this.position = this.clampPosition(saved.left, saved.top);
      }
    } catch (error) {
      debugWarn('[Social Copilot] Failed to restore panel position', error);
    } finally {
      this.applyPosition();
    }
  }

  private async savePosition() {
    if (!this.position) return;

    const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!storage) return;

    try {
      await storage.set({
        [this.positionStorageKey]: this.position,
      });
    } catch (error) {
      debugWarn('[Social Copilot] Failed to save panel position', error);
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
