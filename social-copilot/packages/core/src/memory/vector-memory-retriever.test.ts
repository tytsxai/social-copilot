import { describe, expect, it } from 'vitest';
import { VectorMemoryRetriever } from './vector-memory-retriever';
import { InMemoryVectorStore } from './vector-store';
import type { EmbeddingService } from './memory-types';

class FakeEmbedder implements EmbeddingService {
  async embed(text: string): Promise<number[]> {
    // 简单字符码和作为向量，便于确定性测试
    const sum = text.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return [sum, text.length];
  }
}

describe('VectorMemoryRetriever', () => {
  it('inserts and retrieves snippets ordered by similarity', async () => {
    const store = new InMemoryVectorStore();
    const retriever = new VectorMemoryRetriever({ vectorStore: store, embeddingService: new FakeEmbedder() });

    await retriever.addSnippets([
      { text: 'hello', contactKey: { app: 'other', peerId: 'u1', platform: 'web', conversationId: 'c1', isGroup: false }, partition: 'p1', timestamp: 1 },
      { text: 'hello world', contactKey: { app: 'other', peerId: 'u1', platform: 'web', conversationId: 'c1', isGroup: false }, partition: 'p1', timestamp: 2 },
      { text: 'goodbye', contactKey: { app: 'other', peerId: 'u1', platform: 'web', conversationId: 'c1', isGroup: false }, partition: 'p1', timestamp: 3 },
    ]);

    const res = await retriever.query({ queryText: 'hello', topK: 2, contactKey: { app: 'other', peerId: 'u1', platform: 'web', conversationId: 'c1', isGroup: false }, partition: 'p1' });

    expect(res).toHaveLength(2);
    // 相似度第一名应是文本最接近的 'hello'
    expect(res[0].text).toBe('hello');
  });

  it('filters strictly by full contact key when provided', async () => {
    const store = new InMemoryVectorStore();
    const retriever = new VectorMemoryRetriever({ vectorStore: store, embeddingService: new FakeEmbedder() });

    const contactA = { app: 'other' as const, peerId: 'u1', platform: 'web' as const, conversationId: 'c1', isGroup: false };
    const contactB = { ...contactA, conversationId: 'c2' };

    await retriever.addSnippets([
      { text: 'hello from A', contactKey: contactA, partition: 'p1', timestamp: 1 },
      { text: 'hello from B', contactKey: contactB, partition: 'p1', timestamp: 2 },
    ]);

    const res = await retriever.query({ queryText: 'hello', topK: 5, contactKey: contactA, partition: 'p1' });
    expect(res).toHaveLength(1);
    expect(res[0].text).toBe('hello from A');
  });
});
