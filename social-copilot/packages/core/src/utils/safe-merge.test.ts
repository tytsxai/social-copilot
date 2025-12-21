import { describe, expect, it } from 'vitest';
import { safeAssignPlain } from './safe-merge';

describe('safeAssignPlain', () => {
  it('copies only own enumerable properties and filters dangerous keys', () => {
    const target: Record<string, unknown> = { a: 1 };
    // Create source with b property and attempt __proto__ pollution
    const source = { b: 2 } as Record<string, unknown>;
    // Attempt to add __proto__ as own property (will be filtered)
    Object.defineProperty(source, '__proto__', { value: { polluted: true }, enumerable: true });

    const out = safeAssignPlain(target, source);

    expect(out).toBe(target);
    expect(out).toEqual({ a: 1, b: 2 });
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(({} as any).polluted).toBeUndefined();
  });

  it('filters constructor and prototype keys', () => {
    const target: Record<string, unknown> = {};
    const source = { ok: 1 } as Record<string, unknown>;
    Object.defineProperty(source, 'constructor', { value: { polluted: true }, enumerable: true });
    Object.defineProperty(source, 'prototype', { value: { polluted: true }, enumerable: true });

    const out = safeAssignPlain(target, source);
    expect(out).toEqual({ ok: 1 });
    expect(Object.hasOwn(out, 'constructor')).toBe(false);
    expect(Object.hasOwn(out, 'prototype')).toBe(false);
  });

  it('throws when target is not a plain object', () => {
    expect(() => safeAssignPlain([] as any, { a: 1 } as any)).toThrow(
      'safeAssignPlain target must be a plain object'
    );
  });

  it('does not copy inherited properties from plain object with custom proto', () => {
    // Object.create(proto) is NOT a plain object, so it gets ignored entirely
    // Test with a plain object that has inherited-like behavior via defineProperty
    const source = { own: 'ok' };
    Object.defineProperty(source, 'nonEnumerable', { value: 'hidden', enumerable: false });

    const out = safeAssignPlain({}, source);
    expect(out).toEqual({ own: 'ok' });
    expect(out).not.toHaveProperty('nonEnumerable');
  });

  it('ignores non-plain objects created with Object.create', () => {
    const proto = { inherited: 'nope' };
    const source = Object.create(proto) as Record<string, unknown>;
    source.own = 'ok';

    // Object.create(proto) has proto !== Object.prototype, so it's not plain
    const out = safeAssignPlain({ existing: 1 }, source);
    expect(out).toEqual({ existing: 1 }); // source ignored
  });

  it('ignores non-plain sources (arrays, null)', () => {
    expect(safeAssignPlain({ a: 1 }, null as any)).toEqual({ a: 1 });
    expect(safeAssignPlain({ a: 1 }, [] as any)).toEqual({ a: 1 });
  });
});
