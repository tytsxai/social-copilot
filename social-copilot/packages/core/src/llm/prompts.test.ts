import { describe, expect, it } from 'vitest';
import type { ContactProfile } from '../types/contact';
import type { ConversationContext, Message } from '../types/message';
import type { LLMInput } from '../types/llm';
import { buildSystemPrompt, buildUserPrompt, getLanguageInstruction, renderConversation } from './prompts';

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'm1',
    contactKey: overrides.contactKey ?? {
      platform: 'web',
      app: 'other',
      conversationId: 'c1',
      peerId: 'p1',
      isGroup: false,
    },
    direction: overrides.direction ?? 'incoming',
    senderName: overrides.senderName ?? '对方',
    text: overrides.text ?? 'hello',
    timestamp: overrides.timestamp ?? Date.now(),
    raw: overrides.raw,
  };
}

function createContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  const contactKey = overrides.contactKey ?? {
    platform: 'web',
    app: 'other',
    conversationId: 'c1',
    peerId: 'peer-1',
    isGroup: false,
  };
  return {
    contactKey,
    recentMessages: overrides.recentMessages ?? [
      createMessage({ id: 'm1', contactKey, direction: 'incoming', senderName: 'Alice', text: 'Hi' }),
      createMessage({ id: 'm2', contactKey, direction: 'outgoing', senderName: 'Me', text: 'Hello' }),
    ],
    currentMessage: overrides.currentMessage ?? createMessage({ id: 'm3', contactKey, direction: 'incoming', senderName: 'Alice', text: 'How are you?' }),
  };
}

function createProfile(overrides: Partial<ContactProfile> = {}): ContactProfile {
  return {
    key: overrides.key ?? {
      platform: 'web',
      app: 'other',
      conversationId: 'c1',
      peerId: 'peer-1',
      isGroup: false,
    },
    displayName: overrides.displayName ?? 'Alice',
    interests: overrides.interests ?? ['music', 'travel'],
    relationshipType: overrides.relationshipType,
    communicationStyle: overrides.communicationStyle,
    basicInfo: overrides.basicInfo,
    notes: overrides.notes,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

function createInput(overrides: Partial<LLMInput> = {}): LLMInput {
  return {
    context: overrides.context ?? createContext(),
    profile: overrides.profile,
    memorySummary: overrides.memorySummary,
    styles: overrides.styles ?? ['humorous', 'caring'],
    language: overrides.language ?? 'zh',
    maxLength: overrides.maxLength,
    task: overrides.task,
    thoughtDirection: overrides.thoughtDirection,
    thoughtHint: overrides.thoughtHint,
  };
}

describe('getLanguageInstruction', () => {
  it('maps known language codes', () => {
    expect(getLanguageInstruction('zh')).toBe('中文');
    expect(getLanguageInstruction('en')).toBe('English');
  });

  it('falls back for unknown or missing language', () => {
    expect(getLanguageInstruction('auto')).toContain('跟随对话原语言');
    expect(getLanguageInstruction(undefined)).toContain('跟随对话原语言');
  });
});

describe('renderConversation', () => {
  it('renders recent messages and prefers profile displayName for incoming', () => {
    const context = createContext();
    const profile = createProfile({ displayName: '小明' });
    const text = renderConversation(context, profile);

    expect(text).toContain('【最近对话】');
    expect(text).toContain('小明: Hi');
    expect(text).toContain('我: Hello');
  });
});

describe('buildSystemPrompt', () => {
  it('builds reply system prompt with thought hint', () => {
    const input = createInput({ thoughtHint: '更温柔一点' });
    const prompt = buildSystemPrompt('reply', input);

    expect(prompt).toContain('高情商社交助理');
    expect(prompt).toContain('使用中文回复');
    expect(prompt).toContain('【回复方向】更温柔一点');
  });

  it('builds profile and memory system prompts', () => {
    const input = createInput({ language: 'en' });
    expect(buildSystemPrompt('profile_extraction', input)).toContain('仅返回 JSON 对象');
    expect(buildSystemPrompt('profile_extraction', input)).toContain('使用English返回结果');
    expect(buildSystemPrompt('memory_extraction', input)).toContain('openLoops');
  });

  it('clamps oversized thoughtHint to avoid prompt bloat', () => {
    const hint = 'x'.repeat(800);
    const input = createInput({ thoughtHint: hint });
    const prompt = buildSystemPrompt('reply', input);

    expect(prompt).toContain('【回复方向】' + 'x'.repeat(600));
    expect(prompt).not.toContain('【回复方向】' + hint);
  });
});

describe('buildUserPrompt', () => {
  it('builds reply user prompt with profile, memory and styles', () => {
    const input = createInput({
      profile: createProfile({ displayName: 'Alice', relationshipType: 'friend', interests: ['电影'] }),
      memorySummary: '喜欢科幻片',
      styles: ['formal', 'casual'],
      thoughtHint: '先共情再建议',
    });

    const prompt = buildUserPrompt('reply', input);
    expect(prompt).toContain('【联系人】Alice（friend）');
    expect(prompt).toContain('兴趣：电影');
    expect(prompt).toContain('【历史记忆】喜欢科幻片');
    expect(prompt).toContain('【待回复消息】');
    expect(prompt).toContain('请生成 2 个不同风格的回复建议');
    expect(prompt).toContain('风格分别为：formal、casual');
    expect(prompt).toContain('【回复方向要求】先共情再建议');
  });

  it('builds profile extraction user prompt including JSON example', () => {
    const input = createInput({
      profile: createProfile({ displayName: 'Alice', interests: ['篮球'], relationshipType: 'colleague' }),
      memorySummary: '经常加班',
    });
    const prompt = buildUserPrompt('profile_extraction', input);

    expect(prompt).toContain('画像信息');
    expect(prompt).toContain('补充说明：经常加班');
    expect(prompt).toContain('Alice: Hi');
    expect(prompt).toContain('"interests":[]');
  });

  it('builds memory extraction user prompt including JSON example', () => {
    const input = createInput({
      profile: createProfile({ displayName: 'Alice' }),
      memorySummary: '最近在搬家',
    });
    const prompt = buildUserPrompt('memory_extraction', input);

    expect(prompt).toContain('长期记忆');
    expect(prompt).toContain('现有长期记忆：最近在搬家');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"openLoops"');
  });

  it('clamps oversized memorySummary to avoid prompt bloat', () => {
    const memory = 'm'.repeat(2100);
    const input = createInput({ memorySummary: memory });
    const prompt = buildUserPrompt('reply', input);

    expect(prompt).toContain('【历史记忆】' + 'm'.repeat(2000));
    expect(prompt).not.toContain('【历史记忆】' + memory);
  });
});
