import { escapeHtml } from '../utils/escape-html';

const styleLabelMap: Record<string, string> = {
  humorous: '😄 幽默',
  caring: '💗 关心',
  rational: '🧠 理性',
  casual: '😊 随意',
  formal: '📝 正式',
};

export function getStyleLabel(style: string): string {
  return styleLabelMap[style] || style;
}

export function renderStyleStats(
  preference: { styleHistory?: { style: string; count: number }[] } | null
): string {
  if (!preference || !preference.styleHistory || preference.styleHistory.length === 0) {
    return '<span class="muted">暂无风格选择记录</span>';
  }

  const sorted = [...preference.styleHistory].sort((a, b) => b.count - a.count);
  return sorted
    .map(
      (entry) =>
        `<span class="style-pill">${escapeHtml(getStyleLabel(entry.style))} <strong>${escapeHtml(String(entry.count))}</strong></span>`
    )
    .join('');
}
