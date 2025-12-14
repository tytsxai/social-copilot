import { SlackAdapter } from '../adapters/slack';
import { CopilotContentScript } from './base';

const adapter = new SlackAdapter();

const script = new CopilotContentScript({
  app: 'slack',
  adapter,
  waitForChatSelectors: ['.c-virtual_list__scroll_container'],
  setupNavigationListener: (onChange) => {
    let lastConversationId = adapter.extractContactKey()?.conversationId ?? null;

    const intervalId = window.setInterval(() => {
      const nextConversationId = adapter.extractContactKey()?.conversationId ?? null;
      if (!nextConversationId || nextConversationId === lastConversationId) return;
      lastConversationId = nextConversationId;
      onChange();
    }, 1000);

    return () => clearInterval(intervalId);
  },
  adapterBrokenMessage: 'Slack 页面结构可能已变化，建议刷新页面或更新扩展。',
});

script.init().catch(console.error);
