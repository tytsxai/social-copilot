import type { ContactKey } from '../types';

/**
 * 语义记忆片段
 */
export interface MemorySnippet {
  id: string;
  text: string;
  vector: number[];
  contactKey?: ContactKey;
  partition?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  score?: number; // 仅查询结果返回
}

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
}

export interface MemoryRetriever {
  addSnippets(snippets: Array<Omit<MemorySnippet, 'vector' | 'id' | 'score'>>): Promise<string[]>;
  query(options: {
    queryText: string;
    topK: number;
    contactKey?: ContactKey;
    partition?: string;
    filter?: (snippet: MemorySnippet) => boolean;
  }): Promise<MemorySnippet[]>;
}
