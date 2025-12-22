import { TelegramAdapter } from '../adapters/telegram';
import { CopilotContentScript } from './base';
import { debugError } from '../utils/debug';

const adapter = new TelegramAdapter();

const script = new CopilotContentScript({
  app: 'telegram',
  adapter,
  waitForChatSelectors: [
    '[data-testid="message-list"]',
    '#message-list',
    '.messages-container',
    '.bubbles-inner',
  ],
  setupNavigationListener: (onChange) => {
    let lastHash = window.location.hash;
    let lastConversationId = adapter.extractContactKey()?.conversationId ?? null;
    const checkChange = () => {
      const nextHash = window.location.hash;
      const nextConversationId = adapter.extractContactKey()?.conversationId ?? null;
      const hashChanged = nextHash !== lastHash;
      const convChanged = Boolean(nextConversationId && nextConversationId !== lastConversationId);
      if (!hashChanged && !convChanged) return;
      lastHash = nextHash;
      if (nextConversationId) lastConversationId = nextConversationId;
      onChange();
    };
    const onHashChange = () => checkChange();

    window.addEventListener('hashchange', onHashChange);

    const intervalId = window.setInterval(() => {
      checkChange();
    }, 1000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('hashchange', onHashChange);
    };
  },
  adapterBrokenMessage: 'Telegram 页面结构可能已变化，建议刷新页面或更新扩展。',
});

script.init().catch((error) => {
  debugError('[Social Copilot] Telegram content script init failed:', error);
});
