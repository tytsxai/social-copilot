/* eslint-disable @typescript-eslint/no-explicit-any */

type IssuePath = Array<string | number>;

export type ZodIssue = {
  path: IssuePath;
  message: string;
};

export class ZodError extends Error {
  issues: ZodIssue[];

  constructor(issues: ZodIssue[]) {
    super('Zod validation error');
    this.name = 'ZodError';
    this.issues = issues;
  }
}

type ParseOk<T> = { success: true; data: T };
type ParseFail = { success: false; error: ZodError };
type SafeParseResult<T> = ParseOk<T> | ParseFail;

type Parser<T> = (value: unknown, path: IssuePath) => { ok: true; value: T } | { ok: false; issues: ZodIssue[] };

class Schema<T> {
  private parser: Parser<T>;

  constructor(parser: Parser<T>) {
    this.parser = parser;
  }

  safeParse(value: unknown): SafeParseResult<T> {
    const result = this.parser(value, []);
    if (result.ok) return { success: true, data: result.value };
    return { success: false, error: new ZodError(result.issues) };
  }

  optional(): Schema<T | undefined> {
    return new Schema<T | undefined>((value, path) => {
      if (value === undefined) return { ok: true, value: undefined };
      return this.parser(value, path);
    });
  }

  nullable(): Schema<T | null> {
    return new Schema<T | null>((value, path) => {
      if (value === null) return { ok: true, value: null };
      return this.parser(value, path);
    });
  }

  refine(check: (value: T) => boolean, opts?: { message?: string; path?: IssuePath }): Schema<T> {
    return new Schema<T>((value, path) => {
      const result = this.parser(value, path);
      if (!result.ok) return result;
      const ok = check(result.value);
      if (ok) return result;
      return {
        ok: false,
        issues: [
          {
            path: opts?.path ?? path,
            message: opts?.message ?? 'Invalid value',
          },
        ],
      };
    });
  }
}

function withMessage(path: IssuePath, message: string): ZodIssue[] {
  return [{ path, message }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseString(value: unknown, path: IssuePath): { ok: true; value: string } | { ok: false; issues: ZodIssue[] } {
  if (typeof value !== 'string') return { ok: false, issues: withMessage(path, 'Expected string') };
  return { ok: true, value };
}

function parseNumber(value: unknown, path: IssuePath): { ok: true; value: number } | { ok: false; issues: ZodIssue[] } {
  if (typeof value !== 'number' || Number.isNaN(value)) return { ok: false, issues: withMessage(path, 'Expected number') };
  return { ok: true, value };
}

class StringSchema extends Schema<string> {
  private checks: Array<(value: string, path: IssuePath) => ZodIssue[] | null> = [];

  constructor() {
    super((value, path) => {
      const base = parseString(value, path);
      if (!base.ok) return base;
      const issues: ZodIssue[] = [];
      for (const check of this.checks) {
        const maybe = check(base.value, path);
        if (maybe) issues.push(...maybe);
      }
      if (issues.length > 0) return { ok: false, issues };
      return { ok: true, value: base.value };
    });
  }

  min(length: number, message?: string): this {
    this.checks.push((value, path) => (value.length >= length ? null : withMessage(path, message ?? `Must be at least ${length} characters`)));
    return this;
  }

  url(message?: string): this {
    this.checks.push((value, path) => {
      try {
        // eslint-disable-next-line no-new
        new URL(value);
        return null;
      } catch {
        return withMessage(path, message ?? 'Invalid url');
      }
    });
    return this;
  }
}

class NumberSchema extends Schema<number> {
  private checks: Array<(value: number, path: IssuePath) => ZodIssue[] | null> = [];

  constructor() {
    super((value, path) => {
      const base = parseNumber(value, path);
      if (!base.ok) return base;
      const issues: ZodIssue[] = [];
      for (const check of this.checks) {
        const maybe = check(base.value, path);
        if (maybe) issues.push(...maybe);
      }
      if (issues.length > 0) return { ok: false, issues };
      return { ok: true, value: base.value };
    });
  }

  int(): this {
    this.checks.push((value, path) => (Number.isInteger(value) ? null : withMessage(path, 'Expected integer')));
    return this;
  }

  positive(message?: string): this {
    this.checks.push((value, path) => (value > 0 ? null : withMessage(path, message ?? 'Must be positive')));
    return this;
  }

  nonnegative(message?: string): this {
    this.checks.push((value, path) => (value >= 0 ? null : withMessage(path, message ?? 'Must be non-negative')));
    return this;
  }

  min(min: number, message?: string): this {
    this.checks.push((value, path) => (value >= min ? null : withMessage(path, message ?? `Must be >= ${min}`)));
    return this;
  }

  max(max: number, message?: string): this {
    this.checks.push((value, path) => (value <= max ? null : withMessage(path, message ?? `Must be <= ${max}`)));
    return this;
  }
}

function booleanSchema(): Schema<boolean> {
  return new Schema<boolean>((value, path) => {
    if (typeof value !== 'boolean') return { ok: false, issues: withMessage(path, 'Expected boolean') };
    return { ok: true, value };
  });
}

function unknownSchema(): Schema<unknown> {
  return new Schema<unknown>((value) => ({ ok: true, value }));
}

function literalSchema<T extends string | number | boolean | null>(literal: T): Schema<T> {
  return new Schema<T>((value, path) => {
    if (value !== literal) return { ok: false, issues: withMessage(path, `Expected literal ${String(literal)}`) };
    return { ok: true, value: literal };
  });
}

function enumSchema<const T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> {
  const set = new Set(values);
  return new Schema<T[number]>((value, path) => {
    if (typeof value !== 'string') return { ok: false, issues: withMessage(path, 'Expected enum string') };
    if (!set.has(value)) return { ok: false, issues: withMessage(path, `Invalid enum value: ${value}`) };
    return { ok: true, value: value as T[number] };
  });
}

function arraySchema<T>(item: Schema<T>): Schema<T[]> {
  return new Schema<T[]>((value, path) => {
    if (!Array.isArray(value)) return { ok: false, issues: withMessage(path, 'Expected array') };
    const out: T[] = [];
    const issues: ZodIssue[] = [];
    value.forEach((v, index) => {
      const parsed = (item as any).parser(v, [...path, index]) as ReturnType<Parser<T>>;
      if (parsed.ok) out.push(parsed.value);
      else issues.push(...parsed.issues);
    });
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: out };
  });
}

function objectSchema<TShape extends Record<string, Schema<any>>>(shape: TShape): Schema<{ [K in keyof TShape]: any }> {
  return new Schema<{ [K in keyof TShape]: any }>((value, path) => {
    if (!isRecord(value)) return { ok: false, issues: withMessage(path, 'Expected object') };
    const out: Record<string, unknown> = {};
    const issues: ZodIssue[] = [];

    for (const [key, schema] of Object.entries(shape)) {
      const parsed = (schema as any).parser((value as any)[key], [...path, key]) as ReturnType<Parser<any>>;
      if (parsed.ok) {
        if (parsed.value !== undefined) out[key] = parsed.value;
      } else {
        issues.push(...parsed.issues);
      }
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: out as { [K in keyof TShape]: any } };
  });
}

function unionSchema<T extends readonly Schema<any>[]>(schemas: T): Schema<any> {
  return new Schema<any>((value, path) => {
    const allIssues: ZodIssue[] = [];
    for (const schema of schemas) {
      const parsed = (schema as any).parser(value, path) as ReturnType<Parser<any>>;
      if (parsed.ok) return parsed;
      allIssues.push(...parsed.issues);
    }
    return { ok: false, issues: allIssues.length > 0 ? allIssues : withMessage(path, 'No union variant matched') };
  });
}

function recordSchema(valueSchema: Schema<any>): Schema<Record<string, any>>;
function recordSchema(keySchema: Schema<string>, valueSchema: Schema<any>): Schema<Record<string, any>>;
function recordSchema(arg1: Schema<any>, arg2?: Schema<any>): Schema<Record<string, any>> {
  const keySchema = arg2 ? (arg1 as Schema<string>) : undefined;
  const valueSchema = (arg2 ? arg2 : arg1) as Schema<any>;

  return new Schema<Record<string, any>>((value, path) => {
    if (!isRecord(value)) return { ok: false, issues: withMessage(path, 'Expected record') };
    const out: Record<string, any> = {};
    const issues: ZodIssue[] = [];

    for (const [k, v] of Object.entries(value)) {
      if (keySchema) {
        const keyParsed = (keySchema as any).parser(k, [...path, k]) as ReturnType<Parser<string>>;
        if (!keyParsed.ok) {
          issues.push(...keyParsed.issues);
          continue;
        }
      }
      const valueParsed = (valueSchema as any).parser(v, [...path, k]) as ReturnType<Parser<any>>;
      if (valueParsed.ok) out[k] = valueParsed.value;
      else issues.push(...valueParsed.issues);
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: out };
  });
}

export const z = {
  ZodError,
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => booleanSchema(),
  unknown: () => unknownSchema(),
  object: <TShape extends Record<string, Schema<any>>>(shape: TShape) => objectSchema(shape) as any,
  array: <T>(schema: Schema<T>) => arraySchema(schema),
  enum: <const T extends readonly [string, ...string[]]>(values: T) => enumSchema(values),
  literal: <T extends string | number | boolean | null>(value: T) => literalSchema(value),
  union: <T extends readonly Schema<any>[]>(schemas: T) => unionSchema(schemas),
  record: ((a: any, b?: any) => (b ? recordSchema(a, b) : recordSchema(a))) as any,
  infer: null as any,
};
