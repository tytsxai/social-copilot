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

export interface InMemoryVectorStoreOptions {
  /** Maximum number of records to keep (default: 10000). */
  maxSize?: number;
  /**
   * Optional TTL in milliseconds. Expired records are lazily pruned on access.
   * Omit to disable expiration.
   */
  ttl?: number;
}

type StoreEntry = {
  record: VectorRecord;
  expiresAt?: number;
};

type ScoredRecord = {
  record: VectorRecord;
  score: number;
  order: number;
};

class MinHeap<T> {
  private data: T[] = [];
  private compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  size() {
    return this.data.length;
  }

  peek() {
    return this.data[0];
  }

  push(item: T) {
    this.data.push(item);
    this.siftUp(this.data.length - 1);
  }

  replaceTop(item: T) {
    if (this.data.length === 0) {
      this.data.push(item);
      return;
    }
    this.data[0] = item;
    this.siftDown(0);
  }

  toArray() {
    return this.data.slice();
  }

  private siftUp(index: number) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[parent]) >= 0) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  private siftDown(index: number) {
    let i = index;
    const length = this.data.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < length && this.compare(this.data[left], this.data[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.data[right], this.data[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}

export class InMemoryVectorStore implements VectorStore {
  private store: Map<string, StoreEntry> = new Map();
  private readonly maxSize: number;
  private readonly ttl?: number;
  private evictionCount = 0;
  private expiredPrunedCount = 0;
  private lastPruneAt: number | null = null;

  constructor(options: InMemoryVectorStoreOptions = {}) {
    const maxSize = options.maxSize ?? 10000;
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error('Invalid maxSize');
    }
    if (options.ttl !== undefined && (!Number.isFinite(options.ttl) || options.ttl <= 0)) {
      throw new Error('Invalid ttl');
    }

    this.maxSize = maxSize;
    this.ttl = options.ttl;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    this.pruneExpired();
    for (const record of records) {
      this.validateVector(record.vector);
      const key = this.buildKey(record.id, record.partition);
      const entry: StoreEntry = {
        record,
        expiresAt: this.ttl ? Date.now() + this.ttl : undefined,
      };
      this.touch(key, entry);
      this.evictIfNeeded();
    }
  }

  async delete(ids: string[], partition?: string): Promise<void> {
    this.pruneExpired();
    for (const id of ids) {
      const key = this.buildKey(id, partition);
      this.store.delete(key);
    }
  }

  async query(options: QueryOptions): Promise<Array<{ record: VectorRecord; score: number }>> {
    this.validateVector(options.vector);
    this.pruneExpired();
    const topK = Math.max(0, options.topK);
    if (topK === 0) return [];
    const queryNormSquared = this.vectorNormSquared(options.vector);
    const invQueryNorm = queryNormSquared === 0 ? 0 : 1 / Math.sqrt(queryNormSquared);
    const heap = new MinHeap<ScoredRecord>((a, b) => {
      const scoreDiff = a.score - b.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.order - b.order;
    });
    let order = 0;

    for (const entry of this.store.values()) {
      const rec = entry.record;
      if (options.partition && rec.partition !== options.partition) continue;
      if (options.filter && !options.filter(rec)) continue;
      const score = this.cosineSimilarityWithPrecomputedQueryNorm(options.vector, invQueryNorm, rec.vector);
      const scored = { record: rec, score, order: order++ };
      if (heap.size() < topK) {
        heap.push(scored);
      } else if ((heap.peek()?.score ?? 0) < score) {
        heap.replaceTop(scored);
      }
    }

    const results = heap.toArray().sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.order - b.order;
    });
    for (const { record } of results) {
      const key = this.buildKey(record.id, record.partition);
      const entry = this.store.get(key);
      if (entry) this.touch(key, entry);
    }
    return results;
  }

  async clear(partition?: string): Promise<void> {
    if (!partition) {
      this.store.clear();
      return;
    }
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (entry.record.partition === partition) this.store.delete(key);
    }
  }

  private buildKey(id: string, partition?: string) {
    // Use JSON encoding to avoid key collisions caused by unsafe delimiters.
    return JSON.stringify([id, partition ?? null]);
  }

  private touch(key: string, entry: StoreEntry) {
    // Map preserves insertion order; delete+set moves the key to the most-recently-used position.
    this.store.delete(key);
    this.store.set(key, entry);
  }

  private evictIfNeeded() {
    while (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.store.delete(oldestKey);
      this.evictionCount += 1;
    }
  }

  private pruneExpired(now = Date.now()) {
    if (!this.ttl) return;
    this.lastPruneAt = now;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.store.delete(key);
        this.expiredPrunedCount += 1;
      }
    }
  }

  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      evictionCount: this.evictionCount,
      expiredPrunedCount: this.expiredPrunedCount,
      lastPruneAt: this.lastPruneAt,
    };
  }

  private validateVector(vector: number[]) {
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((v) => !Number.isFinite(v))) {
      throw new Error('Invalid vector');
    }
  }

  private vectorNormSquared(vector: number[]): number {
    let normSquared = 0;
    for (let i = 0; i < vector.length; i++) {
      normSquared += vector[i] * vector[i];
    }
    return normSquared;
  }

  private cosineSimilarityWithPrecomputedQueryNorm(query: number[], invQueryNorm: number, candidate: number[]): number {
    if (query.length !== candidate.length) {
      throw new Error('Vector dimensions do not match');
    }

    if (invQueryNorm === 0) return 0;

    let dot = 0;
    let candidateNormSquared = 0;
    for (let i = 0; i < query.length; i++) {
      dot += query[i] * candidate[i];
      candidateNormSquared += candidate[i] * candidate[i];
    }

    if (candidateNormSquared === 0) return 0;
    return (dot * invQueryNorm) / Math.sqrt(candidateNormSquared);
  }
}
