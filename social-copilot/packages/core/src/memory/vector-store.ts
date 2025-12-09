export interface VectorRecord {
  id: string;
  vector: number[];
  /** 任意扩展元数据，便于过滤或回溯 */
  metadata?: Record<string, unknown>;
  /** 可选分区，用于区分用户/设备/联系人等命名空间 */
  partition?: string;
  contactKey?: import('../types').ContactKey;
  text?: string;
  timestamp?: number;
}

export interface QueryOptions {
  vector: number[];
  topK: number;
  partition?: string;
  /** 自定义过滤器，例如按联系人或时间范围过滤 */
  filter?: (record: VectorRecord) => boolean;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  delete(ids: string[], partition?: string): Promise<void>;
  query(options: QueryOptions): Promise<Array<{ record: VectorRecord; score: number }>>;
  clear(partition?: string): Promise<void>;
}

export class InMemoryVectorStore implements VectorStore {
  private store: Map<string, VectorRecord> = new Map();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.validateVector(record.vector);
      const key = this.buildKey(record.id, record.partition);
      this.store.set(key, record);
    }
  }

  async delete(ids: string[], partition?: string): Promise<void> {
    for (const id of ids) {
      const key = this.buildKey(id, partition);
      this.store.delete(key);
    }
  }

  async query(options: QueryOptions): Promise<Array<{ record: VectorRecord; score: number }>> {
    this.validateVector(options.vector);
    const candidates = Array.from(this.store.values()).filter((rec) => {
      if (options.partition && rec.partition !== options.partition) return false;
      if (options.filter && !options.filter(rec)) return false;
      return true;
    });

    const scored = candidates.map((rec) => ({
      record: rec,
      score: this.cosineSimilarity(options.vector, rec.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, options.topK));
  }

  async clear(partition?: string): Promise<void> {
    if (!partition) {
      this.store.clear();
      return;
    }
    for (const key of Array.from(this.store.keys())) {
      if (key.endsWith(`|${partition}`)) {
        this.store.delete(key);
      }
    }
  }

  private buildKey(id: string, partition?: string) {
    return partition ? `${id}|${partition}` : id;
  }

  private validateVector(vector: number[]) {
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((v) => !Number.isFinite(v))) {
      throw new Error('Invalid vector');
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions do not match');
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / Math.sqrt(normA * normB);
  }
}
