import type { PlatformAdapter } from './base';
import { TelegramAdapter } from './telegram';
import { WhatsAppAdapter } from './whatsapp';
import { SlackAdapter } from './slack';

// 注册所有适配器
const adapters: PlatformAdapter[] = [
  new TelegramAdapter(),
  new WhatsAppAdapter(),
  new SlackAdapter(),
];

/**
 * 获取当前页面匹配的适配器
 */
export function getAdapter(): PlatformAdapter | null {
  for (const adapter of adapters) {
    if (adapter.isMatch()) {
      return adapter;
    }
  }
  return null;
}

export { PlatformAdapter } from './base';
export { TelegramAdapter } from './telegram';
export { WhatsAppAdapter } from './whatsapp';
export { SlackAdapter } from './slack';
