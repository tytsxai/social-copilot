import { WhatsAppAdapter } from '../adapters/whatsapp';
import { CopilotContentScript } from './base';

const adapter = new WhatsAppAdapter();

const script = new CopilotContentScript({
  app: 'whatsapp',
  adapter,
  waitForChatSelectors: ['#main'],
  setupNavigationListener: (onChange) => {
    const header = document.querySelector('#main header');
    if (!header) return;

    let currentTitle = header.querySelector('[title]')?.getAttribute('title') || '';
    const observer = new MutationObserver(() => {
      const nextTitle = header.querySelector('[title]')?.getAttribute('title') || '';
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

script.init().catch(console.error);
