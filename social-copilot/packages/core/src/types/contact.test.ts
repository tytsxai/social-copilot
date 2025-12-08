import { describe, expect, test } from 'vitest';
import type { ContactKey } from './contact';
import { contactKeyToString } from './contact';

const baseKey: ContactKey = {
  platform: 'web',
  app: 'telegram',
  conversationId: 'conv-1',
  peerId: 'peer-1',
  isGroup: false,
};

describe('contactKeyToString', () => {
  test('includes account identifier when present', () => {
    const first = { ...baseKey, accountId: 'acc-1' };
    const second = { ...baseKey, accountId: 'acc-2' };

    expect(contactKeyToString(first)).toContain(':acc-1:');
    expect(contactKeyToString(first)).not.toBe(contactKeyToString(second));
  });

  test('marks group chats distinctly', () => {
    const dm = contactKeyToString({ ...baseKey, accountId: 'acc-1', isGroup: false });
    const group = contactKeyToString({ ...baseKey, accountId: 'acc-1', isGroup: true });

    expect(dm.endsWith(':dm')).toBe(true);
    expect(group.endsWith(':group')).toBe(true);
    expect(dm).not.toBe(group);
  });

  test('falls back gracefully when account id is missing', () => {
    const keyStr = contactKeyToString(baseKey);

    expect(keyStr).toContain(`${baseKey.platform}:${baseKey.app}:`);
    expect(keyStr.includes('undefined')).toBe(false);
  });
});
