const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type AnyRecord = Record<string, unknown>;

function isObjectLike(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is AnyRecord {
  if (!isObjectLike(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Safely assigns enumerable own properties from `source` to `target`.
 *
 * - Filters prototype-pollution keys: `__proto__`, `prototype`, `constructor`
 * - Copies only own enumerable string keys
 * - Ignores non-plain-object sources (arrays, functions, class instances, etc.)
 */
export function safeAssignPlain<TTarget extends AnyRecord, TSource extends AnyRecord>(
  target: TTarget,
  source: TSource | undefined | null
): TTarget {
  if (!isPlainObject(target)) {
    throw new TypeError('safeAssignPlain target must be a plain object');
  }

  if (!isPlainObject(source)) {
    return target;
  }

  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    (target as AnyRecord)[key] = source[key];
  }

  return target;
}

