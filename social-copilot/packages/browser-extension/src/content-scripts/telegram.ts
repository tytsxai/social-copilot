import { TelegramAdapter } from '../adapters/telegram';
import { CopilotContentScript } from './base';

const adapter = new TelegramAdapter();

const script = new CopilotContentScript({
  app: 'telegram',
  adapter,
  waitForChatSelectors: ['.bubbles-inner', '#message-list', '.messages-container'],
  setupNavigationListener: (onChange) => {
    let lastHash = window.location.hash;
    const onHashChange = () => {
      if (window.location.hash === lastHash) return;
      lastHash = window.location.hash;
      onChange();
    };

    window.addEventListener('hashchange', onHashChange);

    const intervalId = window.setInterval(() => {
      if (window.location.hash !== lastHash) {
        lastHash = window.location.hash;
        onChange();
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('hashchange', onHashChange);
    };
  },
  adapterBrokenMessage: 'Telegram 页面结构可能已变化，建议刷新页面或更新扩展。',
});

script.init().catch(console.error);
