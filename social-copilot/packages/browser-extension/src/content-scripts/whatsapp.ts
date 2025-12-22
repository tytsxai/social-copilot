import { WhatsAppAdapter } from '../adapters/whatsapp';
import { CopilotContentScript, findFirstSelector, logSelectorFallback } from './base';
import { debugError } from '../utils/debug';

const adapter = new WhatsAppAdapter();

const script = new CopilotContentScript({
  app: 'whatsapp',
  adapter,
  waitForChatSelectors: [
    '#main [data-testid="conversation-panel-body"]',
    '#main [data-testid="conversation-panel-wrapper"]',
    '#main [role="application"]',
    '#main',
  ],
  setupNavigationListener: (onChange) => {
    const headerSelectors = [
      '#main header[data-testid="conversation-header"]',
      '#main header',
      'header[data-testid="conversation-header"]',
      'header',
    ];
    const titleSelectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-info-header-title"]',
      '[title]',
      'span[title]',
    ];
    const headerMatch = findFirstSelector(headerSelectors);
    if (!headerMatch) {
      logSelectorFallback('whatsapp', 'nav_header', headerSelectors, null);
      let lastConversationId = adapter.extractContactKey()?.conversationId ?? null;
      const intervalId = window.setInterval(() => {
        const nextConversationId = adapter.extractContactKey()?.conversationId ?? null;
        if (nextConversationId && nextConversationId !== lastConversationId) {
          lastConversationId = nextConversationId;
          onChange();
        }
      }, 1000);
      return () => clearInterval(intervalId);
    }

    if (headerMatch.index > 0) {
      logSelectorFallback('whatsapp', 'nav_header', headerSelectors, headerMatch);
    }

    const header = headerMatch.element as HTMLElement;
    let loggedTitleFallback = false;
    const readTitle = () => {
      const titleMatch = findFirstSelector(titleSelectors, header);
      if (!titleMatch) return '';
      if (!loggedTitleFallback && titleMatch.index > 0) {
        logSelectorFallback('whatsapp', 'nav_title', titleSelectors, titleMatch);
        loggedTitleFallback = true;
      }
      const el = titleMatch.element as HTMLElement;
      return el.getAttribute('title') || el.textContent?.trim() || '';
    };

    let currentTitle = readTitle();
    const observer = new MutationObserver(() => {
      const nextTitle = readTitle();
      if (nextTitle && nextTitle !== currentTitle) {
        currentTitle = nextTitle;
        onChange();
      }
    });

    observer.observe(header, { subtree: true, attributes: true });
    return () => observer.disconnect();
  },
  adapterBrokenMessage: 'WhatsApp 页面结构可能已变化，建议刷新页面或更新扩展。',
});

script.init().catch((error) => {
  debugError('[Social Copilot] WhatsApp content script init failed:', error);
});
