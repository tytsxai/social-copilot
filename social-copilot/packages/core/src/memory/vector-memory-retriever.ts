import type { MemorySnippet, EmbeddingService, MemoryRetriever } from './memory-types';
import type { VectorStore } from './vector-store';
import { v4 as uuidv4 } from 'uuid';

export interface VectorMemoryRetrieverOptions {
  vectorStore: VectorStore;
  embeddingService: EmbeddingService;
}

/**
 * 默认的基于向量存储的语义记忆检索器。
 */
export class VectorMemoryRetriever implements MemoryRetriever {
  private store: VectorStore;
  private embedder: EmbeddingService;

  constructor(options: VectorMemoryRetrieverOptions) {
    this.store = options.vectorStore;
    this.embedder = options.embeddingService;
  }

  async addSnippets(snippets: Array<Omit<MemorySnippet, 'vector' | 'id' | 'score'>>): Promise<string[]> {
    const enriched = await Promise.all(
      snippets.map(async (snippet) => {
        const vector = await this.embedder.embed(snippet.text);
        return {
          ...snippet,
          id: (snippet as Partial<MemorySnippet>).id ?? uuidv4(),
          vector,
          timestamp: snippet.timestamp ?? Date.now(),
        } as MemorySnippet;
      })
    );

    await this.store.upsert(enriched);
    return enriched.map((s) => s.id);
  }

  async query(options: {
    queryText: string;
    topK: number;
    contactKey?: MemorySnippet['contactKey'];
    partition?: string;
    filter?: (snippet: MemorySnippet) => boolean;
  }): Promise<MemorySnippet[]> {
    const queryVector = await this.embedder.embed(options.queryText);
    const results = await this.store.query({
      vector: queryVector,
      topK: options.topK,
      partition: options.partition,
      filter: (rec) => {
        const snippet = rec as unknown as MemorySnippet;
        if (options.contactKey && snippet.contactKey?.peerId !== options.contactKey.peerId) return false;
        if (options.contactKey && snippet.contactKey?.app !== options.contactKey.app) return false;
        if (options.filter && !options.filter(snippet)) return false;
        return true;
      },
    });

    // 将得分写回 snippet，保留其余字段
    return results.map(({ record, score }) => ({ ...record, score } as MemorySnippet));
  }
}
