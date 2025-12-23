import type { LLMInput } from '@social-copilot/core';

const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function escapePromptValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getContactName(input: LLMInput): string {
  if (input.profile?.displayName) return input.profile.displayName;
  if (input.context?.currentMessage?.senderName) return input.context.currentMessage.senderName;
  return input.context?.contactKey?.peerId || '';
}

export function interpolateCustomPrompt(template: string, input: LLMInput): string {
  return template.replace(VARIABLE_RE, (match, rawKey: string) => {
    const key = String(rawKey || '').trim();
    const value = (() => {
      switch (key) {
        case 'contact_name':
          return getContactName(input);
        case 'peer_id':
          return input.context.contactKey.peerId;
        case 'conversation_id':
          return input.context.contactKey.conversationId;
        case 'platform':
          return input.context.contactKey.platform;
        case 'app':
          return input.context.contactKey.app;
        case 'is_group':
          return String(input.context.contactKey.isGroup);
        case 'styles':
          return input.styles.join(', ');
        case 'suggestion_count':
          return String(input.styles.length);
        case 'language':
          return input.language;
        case 'thought_direction':
          return input.thoughtDirection ?? '';
        default:
          return undefined;
      }
    })();

    if (value === undefined) return match;
    return escapePromptValue(String(value));
  });
}
