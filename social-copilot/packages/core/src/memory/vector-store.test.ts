import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryVectorStore, type VectorRecord } from './vector-store';

const v = (nums: number[]): number[] => nums;

function cosineSimilarityNaive(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimensions do not match');
  let dot = 0;
  let aNormSquared = 0;
  let bNormSquared = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aNormSquared += a[i] * a[i];
    bNormSquared += b[i] * b[i];
  }
  if (aNormSquared === 0 || bNormSquared === 0) return 0;
  return dot / (Math.sqrt(aNormSquared) * Math.sqrt(bNormSquared));
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts and queries by similarity', async () => {
    const records: VectorRecord[] = [
      { id: 'a', vector: v([1, 0]), metadata: { contact: 'c1' } },
      { id: 'b', vector: v([0.9, 0.1]), metadata: { contact: 'c2' } },
      { id: 'c', vector: v([0, 1]), metadata: { contact: 'c3' } },
    ];
    await store.upsert(records);

    const result = await store.query({ vector: v([1, 0]), topK: 2 });
    expect(result.map((r) => r.record.id)).toEqual(['a', 'b']);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('upsert overrides existing', async () => {
    await store.upsert([{ id: 'x', vector: v([1, 0]) }]);
    await store.upsert([{ id: 'x', vector: v([0, 1]) }]);
    const res = await store.query({ vector: v([0, 1]), topK: 1 });
    expect(res[0].record.id).toBe('x');
    expect(res[0].score).toBeCloseTo(1);
  });

  it('supports delete and partition', async () => {
    await store.upsert([
      { id: 'p1', vector: v([1, 0]), partition: 'user1' },
      { id: 'p2', vector: v([0, 1]), partition: 'user2' },
    ]);

    await store.delete(['p1'], 'user1');
    const res1 = await store.query({ vector: v([1, 0]), topK: 5, partition: 'user1' });
    expect(res1.length).toBe(0);

    const res2 = await store.query({ vector: v([0, 1]), topK: 5, partition: 'user2' });
    expect(res2[0].record.id).toBe('p2');
  });

  it('honors filter', async () => {
    await store.upsert([
      { id: 'k1', vector: v([1, 0]), metadata: { contact: 'alice' } },
      { id: 'k2', vector: v([1, 0]), metadata: { contact: 'bob' } },
    ]);

    const res = await store.query({
      vector: v([1, 0]),
      topK: 5,
      filter: (rec) => rec.metadata?.contact === 'bob',
    });

    expect(res.map((r) => r.record.id)).toEqual(['k2']);
  });

  it('returns zero scores for zero query vector', async () => {
    await store.upsert([
      { id: 'z1', vector: v([1, 0]) },
      { id: 'z2', vector: v([0, 1]) },
    ]);

    const res = await store.query({ vector: v([0, 0]), topK: 5 });
    expect(res.map((r) => r.score)).toEqual([0, 0]);
  });

  it('computes cosine similarity correctly for known vectors (optimized path)', async () => {
    const query = v([3, 4]); // norm = 5
    await store.upsert([
      { id: 'same_direction', vector: v([6, 8]) }, // cosine = 1
      { id: 'opposite_direction', vector: v([-6, -8]) }, // cosine = -1
      { id: 'orthogonal', vector: v([-4, 3]) }, // dot = 0 => cosine = 0
      { id: 'zero_candidate', vector: v([0, 0]) }, // cosine = 0 by definition here
    ]);

    const res = await store.query({ vector: query, topK: 10 });
    const scoresById = new Map(res.map((r) => [r.record.id, r.score]));

    expect(scoresById.get('same_direction')).toBeCloseTo(1, 12);
    expect(scoresById.get('opposite_direction')).toBeCloseTo(-1, 12);
    expect(scoresById.get('orthogonal')).toBeCloseTo(0, 12);
    expect(scoresById.get('zero_candidate')).toBeCloseTo(0, 12);

    expect(res.map((r) => r.record.id).slice(0, 2)).toEqual(['same_direction', 'orthogonal']);
  });

  it('matches naive cosine similarity across many candidates', async () => {
    const rng = mulberry32(1337);
    const dim = 8;
    const query = Array.from({ length: dim }, () => (rng() - 0.5) * 10);

    const records: VectorRecord[] = Array.from({ length: 50 }, (_, idx) => ({
      id: `r${idx}`,
      vector: Array.from({ length: dim }, () => (rng() - 0.5) * 10),
    }));

    await store.upsert(records);
    const res = await store.query({ vector: query, topK: 100 });
    const scoresById = new Map(res.map((r) => [r.record.id, r.score]));

    for (const record of records) {
      const expected = cosineSimilarityNaive(query, record.vector);
      expect(scoresById.get(record.id)).toBeCloseTo(expected, 12);
    }
  });

  it('avoids key collisions between id and partition', async () => {
    // These would collide with an unsafe delimiter-based key like `${id}|${partition}`.
    const r1: VectorRecord = { id: 'a|b', partition: 'c', vector: v([1, 0]) };
    const r2: VectorRecord = { id: 'a', partition: 'b|c', vector: v([0, 1]) };
    await store.upsert([r1, r2]);

    const res1 = await store.query({ vector: v([1, 0]), topK: 10, partition: 'c' });
    expect(res1.map((r) => r.record.id)).toEqual(['a|b']);

    const res2 = await store.query({ vector: v([0, 1]), topK: 10, partition: 'b|c' });
    expect(res2.map((r) => r.record.id)).toEqual(['a']);

    await store.delete(['a|b'], 'c');
    const res2AfterDelete = await store.query({ vector: v([0, 1]), topK: 10, partition: 'b|c' });
    expect(res2AfterDelete.map((r) => r.record.id)).toEqual(['a']);
  });

  it('evicts least-recently-used records when exceeding maxSize', async () => {
    store = new InMemoryVectorStore({ maxSize: 2 });
    await store.upsert([
      { id: 'a', vector: v([1, 0]) },
      { id: 'b', vector: v([0, 1]) },
    ]);

    // Touch `a` so it becomes most-recently-used.
    await store.query({ vector: v([1, 0]), topK: 1 });

    // Insert `c`, should evict `b` (LRU).
    await store.upsert([{ id: 'c', vector: v([1, 0]) }]);

    const res = await store.query({ vector: v([1, 0]), topK: 10 });
    expect(res.map((r) => r.record.id).sort()).toEqual(['a', 'c']);
  });

  it('expires records by ttl', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    store = new InMemoryVectorStore({ ttl: 1000 });
    await store.upsert([{ id: 't1', vector: v([1, 0]) }]);
    expect((await store.query({ vector: v([1, 0]), topK: 10 })).map((r) => r.record.id)).toEqual(['t1']);

    vi.setSystemTime(new Date('2025-01-01T00:00:01.001Z'));
    const resAfter = await store.query({ vector: v([1, 0]), topK: 10 });
    expect(resAfter.length).toBe(0);
  });

  it('clears records in a partition', async () => {
    await store.upsert([
      { id: 'a', partition: 'p1', vector: v([1, 0]) },
      { id: 'b', partition: 'p2', vector: v([0, 1]) },
    ]);

    await store.clear('p1');
    expect((await store.query({ vector: v([1, 0]), topK: 10, partition: 'p1' })).length).toBe(0);
    expect((await store.query({ vector: v([0, 1]), topK: 10, partition: 'p2' })).map((r) => r.record.id)).toEqual([
      'b',
    ]);
  });

  it('performance: topK query remains fast on large candidate sets', async () => {
    const rng = mulberry32(2024);
    const dim = 16;
    const recordCount = 3000;

    const records: VectorRecord[] = Array.from({ length: recordCount }, (_, idx) => ({
      id: `perf-${idx}`,
      vector: Array.from({ length: dim }, () => (rng() - 0.5) * 10),
    }));

    await store.upsert(records);
    const query = Array.from({ length: dim }, () => (rng() - 0.5) * 10);

    const start = performance.now();
    const res = await store.query({ vector: query, topK: 10 });
    const duration = performance.now() - start;

    console.log(`[Performance] topK=10 over ${recordCount} vectors: ${duration.toFixed(2)}ms`);
    expect(res).toHaveLength(10);
    // Keep the threshold generous to avoid flaky failures on slower CI environments.
    expect(duration).toBeLessThan(2000);
  });
});
