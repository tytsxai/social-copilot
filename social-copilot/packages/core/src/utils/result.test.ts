import { describe, test, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  fromPromise,
  fromThrowable,
  ResultWrapper,
  type Result,
} from './result';

describe('Result type - Ok variant', () => {
  test('ok creates Ok result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('isOk returns true for Ok result', () => {
    const result = ok('success');
    expect(isOk(result)).toBe(true);
  });

  test('isErr returns false for Ok result', () => {
    const result = ok('success');
    expect(isErr(result)).toBe(false);
  });

  test('unwrap returns value for Ok result', () => {
    const result = ok(100);
    expect(unwrap(result)).toBe(100);
  });

  test('unwrapOr returns value for Ok result', () => {
    const result = ok(100);
    expect(unwrapOr(result, 0)).toBe(100);
  });

  test('map transforms Ok value', () => {
    const result = ok(5);
    const doubled = map(result, x => x * 2);
    expect(isOk(doubled)).toBe(true);
    if (doubled.ok) {
      expect(doubled.value).toBe(10);
    }
  });

  test('mapErr does not transform Ok value', () => {
    const result = ok(42);
    const mapped = mapErr(result, e => `Error: ${e}`);
    expect(isOk(mapped)).toBe(true);
    if (mapped.ok) {
      expect(mapped.value).toBe(42);
    }
  });

  test('andThen chains Ok results', () => {
    const result = ok(10);
    const chained = andThen(result, x => ok(x * 2));
    expect(isOk(chained)).toBe(true);
    if (chained.ok) {
      expect(chained.value).toBe(20);
    }
  });

  test('andThen can return Err', () => {
    const result = ok(10);
    const chained = andThen(result, x => x > 5 ? err('too large') : ok(x));
    expect(isErr(chained)).toBe(true);
    if (!chained.ok) {
      expect(chained.error).toBe('too large');
    }
  });
});

describe('Result type - Err variant', () => {
  test('err creates Err result', () => {
    const result = err('failed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('failed');
    }
  });

  test('isOk returns false for Err result', () => {
    const result = err('failed');
    expect(isOk(result)).toBe(false);
  });

  test('isErr returns true for Err result', () => {
    const result = err('failed');
    expect(isErr(result)).toBe(true);
  });

  test('unwrap throws for Err result', () => {
    const result = err('failed');
    expect(() => unwrap(result)).toThrow('Called unwrap on an Err value: failed');
  });

  test('unwrap throws with Error message for Err result with Error', () => {
    const result = err(new Error('network error'));
    expect(() => unwrap(result)).toThrow('Called unwrap on an Err value: network error');
  });

  test('unwrapOr returns default for Err result', () => {
    const result = err('failed');
    expect(unwrapOr(result, 0)).toBe(0);
  });

  test('map does not transform Err value', () => {
    const result: Result<number, string> = err('failed');
    const doubled = map(result, x => x * 2);
    expect(isErr(doubled)).toBe(true);
    if (!doubled.ok) {
      expect(doubled.error).toBe('failed');
    }
  });

  test('mapErr transforms Err value', () => {
    const result = err('network error');
    const mapped = mapErr(result, e => `Failed: ${e}`);
    expect(isErr(mapped)).toBe(true);
    if (!mapped.ok) {
      expect(mapped.error).toBe('Failed: network error');
    }
  });

  test('andThen does not chain Err results', () => {
    const result: Result<number, string> = err('failed');
    const chained = andThen(result, x => ok(x * 2));
    expect(isErr(chained)).toBe(true);
    if (!chained.ok) {
      expect(chained.error).toBe('failed');
    }
  });
});

describe('Result type - Type guards', () => {
  test('isOk narrows type to Ok', () => {
    const result: Result<number, string> = ok(42);
    if (isOk(result)) {
      // TypeScript should know result.value exists
      const value: number = result.value;
      expect(value).toBe(42);
    }
  });

  test('isErr narrows type to Err', () => {
    const result: Result<number, string> = err('failed');
    if (isErr(result)) {
      // TypeScript should know result.error exists
      const error: string = result.error;
      expect(error).toBe('failed');
    }
  });

  test('result.ok narrows type', () => {
    const result: Result<number, string> = ok(42);
    if (result.ok) {
      const value: number = result.value;
      expect(value).toBe(42);
    } else {
      const error: string = result.error;
      expect(error).toBeDefined();
    }
  });
});

describe('fromPromise helper', () => {
  test('converts resolved Promise to Ok', async () => {
    const promise = Promise.resolve(42);
    const result = await fromPromise(promise);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('converts rejected Promise to Err', async () => {
    const promise = Promise.reject(new Error('failed'));
    const result = await fromPromise(promise);
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.message).toBe('failed');
    }
  });

  test('converts rejected non-Error to Err with Error', async () => {
    const promise = Promise.reject('string error');
    const result = await fromPromise(promise);
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.message).toBe('string error');
    }
  });

  test('handles async operations', async () => {
    vi.useFakeTimers();
    try {
      const asyncOp = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      };
      const resultPromise = fromPromise(asyncOp());
      await vi.advanceTimersByTimeAsync(10);
      const result = await resultPromise;
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('success');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fromThrowable helper', () => {
  test('wraps successful function', () => {
    const safeParse = fromThrowable(JSON.parse);
    const result = safeParse('{"valid": true}');
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ valid: true });
    }
  });

  test('wraps throwing function', () => {
    const safeParse = fromThrowable(JSON.parse);
    const result = safeParse('invalid json');
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  test('preserves function arguments', () => {
    const divide = (a: number, b: number) => {
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    };
    const safeDivide = fromThrowable(divide);

    const result1 = safeDivide(10, 2);
    expect(isOk(result1)).toBe(true);
    if (result1.ok) {
      expect(result1.value).toBe(5);
    }

    const result2 = safeDivide(10, 0);
    expect(isErr(result2)).toBe(true);
    if (!result2.ok) {
      expect(result2.error.message).toBe('Division by zero');
    }
  });

  test('converts non-Error throws to Error', () => {
    const throwString = () => {
      throw 'string error';
    };
    const safe = fromThrowable(throwString);
    const result = safe();
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.message).toBe('string error');
    }
  });
});

describe('ResultWrapper fluent API', () => {
  test('wraps Result and provides fluent API', () => {
    const result = ResultWrapper.from(ok(5))
      .map(x => x * 2)
      .map(x => x + 1)
      .get();

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(11);
    }
  });

  test('isOk method', () => {
    const wrapper = ResultWrapper.from(ok(42));
    expect(wrapper.isOk()).toBe(true);
  });

  test('isErr method', () => {
    const wrapper = ResultWrapper.from<number, string>(err('failed'));
    expect(wrapper.isErr()).toBe(true);
  });

  test('unwrap method', () => {
    const wrapper = ResultWrapper.from(ok(42));
    expect(wrapper.unwrap()).toBe(42);
  });

  test('unwrapOr method', () => {
    const wrapper = ResultWrapper.from<number, string>(err('failed'));
    expect(wrapper.unwrapOr(0)).toBe(0);
  });

  test('map chains transformations', () => {
    const result = ResultWrapper.from(ok(5))
      .map(x => x * 2)
      .map(x => x.toString())
      .unwrap();

    expect(result).toBe('10');
  });

  test('mapErr transforms error', () => {
    const result = ResultWrapper.from(err('network error'))
      .mapErr(e => `Failed: ${e}`)
      .get();

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe('Failed: network error');
    }
  });

  test('andThen chains Result-returning operations', () => {
    const divide = (a: number, b: number): Result<number, string> => {
      return b === 0 ? err('Division by zero') : ok(a / b);
    };

    const result = ResultWrapper.from<number, string>(ok(10))
      .andThen(x => divide(x, 2))
      .andThen(x => divide(x, 5))
      .unwrap();

    expect(result).toBe(1);
  });

  test('short-circuits on error', () => {
    const result = ResultWrapper.from<number, string>(ok(10))
      .map(x => x * 2)
      .andThen(() => err('failed'))
      .map(x => x * 2) // Should not execute
      .get();

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe('failed');
    }
  });
});

describe('Result type - Functional composition', () => {
  test('complex chain with map and andThen', () => {
    const parseNumber = (s: string): Result<number, string> => {
      const n = Number(s);
      return isNaN(n) ? err('Not a number') : ok(n);
    };

    const divide = (a: number, b: number): Result<number, string> => {
      return b === 0 ? err('Division by zero') : ok(a / b);
    };

    const result = ResultWrapper.from(parseNumber('10'))
      .andThen(x => divide(x, 2))
      .map(x => x * 10)
      .unwrapOr(0);

    expect(result).toBe(50);
  });

  test('error propagation in chain', () => {
    const parseNumber = (s: string): Result<number, string> => {
      const n = Number(s);
      return isNaN(n) ? err('Not a number') : ok(n);
    };

    const result = ResultWrapper.from(parseNumber('invalid'))
      .map(x => x * 2)
      .map(x => x + 1)
      .unwrapOr(0);

    expect(result).toBe(0);
  });

  test('multiple error transformations', () => {
    const result = ResultWrapper.from(err('network error'))
      .mapErr(e => `API: ${e}`)
      .mapErr(e => `Failed - ${e}`)
      .get();

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe('Failed - API: network error');
    }
  });
});

describe('Result type - Property-based tests', () => {
  test('map preserves Ok structure', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const result = ok(n);
        const mapped = map(result, x => x * 2);
        return isOk(mapped);
      })
    );
  });

  test('map preserves Err structure', () => {
    fc.assert(
      fc.property(fc.string(), (error) => {
        const result: Result<number, string> = err(error);
        const mapped = map(result, x => x * 2);
        return isErr(mapped);
      })
    );
  });

  test('unwrapOr always returns a value', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer().map(ok), fc.string().map(err)),
        fc.integer(),
        (result, defaultValue) => {
          const value = unwrapOr(result, defaultValue);
          return typeof value === 'number';
        }
      )
    );
  });

  test('andThen associativity', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const f = (x: number) => ok(x + 1);
        const g = (x: number) => ok(x * 2);

        const result1 = andThen(andThen(ok(n), f), g);
        const result2 = andThen(ok(n), x => andThen(f(x), g));

        return isOk(result1) && isOk(result2) &&
          result1.ok && result2.ok &&
          result1.value === result2.value;
      })
    );
  });
});

describe('Result type - Edge cases', () => {
  test('handles null values', () => {
    const result = ok(null);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(null);
    }
  });

  test('handles undefined values', () => {
    const result = ok(undefined);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(undefined);
    }
  });

  test('handles empty string error', () => {
    const result = err('');
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe('');
    }
  });

  test('handles complex objects', () => {
    const obj = { nested: { value: 42 }, array: [1, 2, 3] };
    const result = ok(obj);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(obj);
    }
  });

  test('handles Error objects', () => {
    const error = new Error('test error');
    const result = err(error);
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });
});

describe('Result type - Real-world scenarios', () => {
  test('API call simulation', async () => {
    const fetchUser = async (id: string): Promise<Result<{ name: string }, Error>> => {
      if (id === 'invalid') {
        return err(new Error('User not found'));
      }
      return ok({ name: 'Alice' });
    };

    const result1 = await fetchUser('123');
    expect(isOk(result1)).toBe(true);

    const result2 = await fetchUser('invalid');
    expect(isErr(result2)).toBe(true);
  });

  test('validation pipeline', () => {
    const validateEmail = (email: string): Result<string, string> => {
      return email.includes('@') ? ok(email) : err('Invalid email');
    };

    const validateLength = (email: string): Result<string, string> => {
      return email.length >= 5 ? ok(email) : err('Email too short');
    };

    const result = ResultWrapper.from(validateEmail('test@example.com'))
      .andThen(validateLength)
      .unwrapOr('');

    expect(result).toBe('test@example.com');
  });

  test('error recovery', () => {
    const parseConfig = (json: string): Result<object, string> => {
      const safeParse = fromThrowable(JSON.parse);
      const result = safeParse(json);
      return mapErr(result, e => `Config parse error: ${e.message}`);
    };

    const result1 = parseConfig('{"valid": true}');
    expect(isOk(result1)).toBe(true);

    const result2 = parseConfig('invalid');
    expect(isErr(result2)).toBe(true);
    if (!result2.ok) {
      expect(result2.error).toContain('Config parse error');
    }
  });

  test('nested Result operations', () => {
    const divide = (a: number, b: number): Result<number, string> => {
      return b === 0 ? err('Division by zero') : ok(a / b);
    };

    const sqrt = (n: number): Result<number, string> => {
      return n < 0 ? err('Negative number') : ok(Math.sqrt(n));
    };

    const result = ResultWrapper.from(divide(16, 4))
      .andThen(sqrt)
      .unwrap();

    expect(result).toBe(2);
  });

  test('error accumulation', () => {
    const errors: string[] = [];

    const validate = (value: number): Result<number, string> => {
      if (value < 0) return err('Negative value');
      if (value > 100) return err('Value too large');
      return ok(value);
    };

    const values = [-1, 50, 150];
    values.forEach(v => {
      const result = validate(v);
      if (isErr(result)) {
        errors.push(result.error);
      }
    });

    expect(errors).toEqual(['Negative value', 'Value too large']);
  });
});

describe('Result type - Performance', () => {
  test('handles large chains efficiently', () => {
    let result = ok(0);

    for (let i = 0; i < 1000; i++) {
      result = map(result, x => x + 1);
    }

    expect(unwrap(result)).toBe(1000);
  });

  test('handles large error chains efficiently', () => {
    let result: Result<number, string> = err('initial error');

    for (let i = 0; i < 1000; i++) {
      result = mapErr(result, e => `${e} -> ${i}`);
    }

    expect(isErr(result)).toBe(true);
  });
});
