import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryVectorStore, type VectorRecord } from './vector-store';

const v = (nums: number[]): number[] => nums;

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
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
});
