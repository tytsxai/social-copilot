import type { MemorySnippet, EmbeddingService, MemoryRetriever } from './memory-types';
import type { VectorStore } from './vector-store';
import { v4 as uuidv4 } from 'uuid';
import { contactKeyEquals } from '../types/contact';

export interface VectorMemoryRetrieverOptions {
  vectorStore: VectorStore;
  embeddingService: EmbeddingService;
  /** 限制单次嵌入并发，避免压垮嵌入服务 */
  maxConcurrentEmbeds?: number;
}

/**
 * 默认的基于向量存储的语义记忆检索器。
 */
export class VectorMemoryRetriever implements MemoryRetriever {
  private store: VectorStore;
  private embedder: EmbeddingService;
  private maxConcurrentEmbeds: number;

  constructor(options: VectorMemoryRetrieverOptions) {
    this.store = options.vectorStore;
    this.embedder = options.embeddingService;
    this.maxConcurrentEmbeds = Math.max(1, options.maxConcurrentEmbeds ?? 5);
  }

  async addSnippets(snippets: Array<Omit<MemorySnippet, 'vector' | 'id' | 'score'>>): Promise<string[]> {
    const enriched: MemorySnippet[] = [];
    for (let i = 0; i < snippets.length; i += this.maxConcurrentEmbeds) {
      const batch = snippets.slice(i, i + this.maxConcurrentEmbeds);
      const batchVectors = await Promise.all(batch.map((snippet) => this.embedder.embed(snippet.text)));
      batch.forEach((snippet, idx) => {
        enriched.push({
          ...snippet,
          id: (snippet as Partial<MemorySnippet>).id ?? uuidv4(),
          vector: batchVectors[idx],
          timestamp: snippet.timestamp ?? Date.now(),
        } as MemorySnippet);
      });
    }

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
        if (options.contactKey) {
          if (!snippet.contactKey) return false;
          if (!contactKeyEquals(snippet.contactKey, options.contactKey)) {
            return false;
          }
        }
        if (options.filter && !options.filter(snippet)) return false;
        return true;
      },
    });

    // 将得分写回 snippet，保留其余字段
    return results.map(({ record, score }) => ({ ...record, score } as MemorySnippet));
  }
}
