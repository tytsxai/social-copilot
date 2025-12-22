import { SlackAdapter } from '../adapters/slack';
import { CopilotContentScript } from './base';
import { debugError } from '../utils/debug';

const adapter = new SlackAdapter();

const script = new CopilotContentScript({
  app: 'slack',
  adapter,
  waitForChatSelectors: [
    '[data-qa="message_pane"]',
    '[data-qa="message_pane"] .c-virtual_list__scroll_container',
    '.c-virtual_list__scroll_container',
    '.p-message_pane__scroller',
  ],
  setupNavigationListener: (onChange) => {
    let lastConversationId = adapter.extractContactKey()?.conversationId ?? null;
    let lastPathname = window.location.pathname;

    const intervalId = window.setInterval(() => {
      const nextConversationId = adapter.extractContactKey()?.conversationId ?? null;
      if (!nextConversationId || nextConversationId === lastConversationId) return;
      lastConversationId = nextConversationId;
      onChange();
      return;
    }, 1000);

    const pathnameIntervalId = window.setInterval(() => {
      const nextConversationId = adapter.extractContactKey()?.conversationId ?? null;
      const nextPathname = window.location.pathname;
      if (nextConversationId) return;
      if (nextPathname === lastPathname) return;
      lastPathname = nextPathname;
      onChange();
    }, 1500);

    return () => {
      clearInterval(intervalId);
      clearInterval(pathnameIntervalId);
    };
  },
  adapterBrokenMessage: 'Slack 页面结构可能已变化，建议刷新页面或更新扩展。',
});

script.init().catch((error) => {
  debugError('[Social Copilot] Slack content script init failed:', error);
});
