/**
 * Result Type System
 *
 * Rust-inspired Result<T, E> type for explicit error handling without exceptions.
 * Provides a type-safe way to handle operations that may fail.
 *
 * @example
 * ```typescript
 * // Basic usage
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('Division by zero');
 *   return ok(a / b);
 * }
 *
 * const result = divide(10, 2);
 * if (result.ok) {
 *   console.log(result.value); // 5
 * } else {
 *   console.error(result.error);
 * }
 *
 * // Functional composition
 * const doubled = divide(10, 2)
 *   .map(x => x * 2)
 *   .unwrapOr(0); // 10
 * ```
 */

/**
 * Result type representing either success (Ok) or failure (Err)
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Type guard to check if Result is Ok
 *
 * @example
 * ```typescript
 * const result = ok(42);
 * if (isOk(result)) {
 *   console.log(result.value); // TypeScript knows result.value exists
 * }
 * ```
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Type guard to check if Result is Err
 *
 * @example
 * ```typescript
 * const result = err('failed');
 * if (isErr(result)) {
 *   console.error(result.error); // TypeScript knows result.error exists
 * }
 * ```
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

/**
 * Create a successful Result
 *
 * @example
 * ```typescript
 * const result = ok(42);
 * console.log(result.value); // 42
 * ```
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create a failed Result
 *
 * @example
 * ```typescript
 * const result = err('Something went wrong');
 * console.log(result.error); // 'Something went wrong'
 * ```
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Unwrap the value or throw an error
 *
 * @throws {Error} If Result is Err
 *
 * @example
 * ```typescript
 * const result = ok(42);
 * console.log(unwrap(result)); // 42
 *
 * const failed = err('oops');
 * unwrap(failed); // throws Error('oops')
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  const errorMessage = result.error instanceof Error
    ? result.error.message
    : String(result.error);
  throw new Error(`Called unwrap on an Err value: ${errorMessage}`);
}

/**
 * Unwrap the value or return a default
 *
 * @example
 * ```typescript
 * const result = ok(42);
 * console.log(unwrapOr(result, 0)); // 42
 *
 * const failed = err('oops');
 * console.log(unwrapOr(failed, 0)); // 0
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Transform the Ok value using a function
 *
 * @example
 * ```typescript
 * const result = ok(5);
 * const doubled = map(result, x => x * 2);
 * console.log(doubled.value); // 10
 *
 * const failed = err('oops');
 * const stillFailed = map(failed, x => x * 2);
 * console.log(stillFailed.error); // 'oops'
 * ```
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Transform the Err value using a function
 *
 * @example
 * ```typescript
 * const result = err('network error');
 * const mapped = mapErr(result, e => `Failed: ${e}`);
 * console.log(mapped.error); // 'Failed: network error'
 *
 * const success = ok(42);
 * const stillSuccess = mapErr(success, e => `Failed: ${e}`);
 * console.log(stillSuccess.value); // 42
 * ```
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chain Result-returning operations (flatMap)
 *
 * @example
 * ```typescript
 * function divide(a: number, b: number): Result<number, string> {
 *   return b === 0 ? err('Division by zero') : ok(a / b);
 * }
 *
 * const result = divide(10, 2)
 *   .andThen(x => divide(x, 5))
 *   .andThen(x => ok(x * 10));
 *
 * console.log(result.value); // 10
 * ```
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Convert a Promise to a Result
 *
 * @example
 * ```typescript
 * const result = await fromPromise(fetch('/api/data'));
 * if (result.ok) {
 *   console.log('Success:', result.value);
 * } else {
 *   console.error('Failed:', result.error);
 * }
 * ```
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wrap a function that may throw into a Result-returning function
 *
 * @example
 * ```typescript
 * const safeParseJSON = fromThrowable(JSON.parse);
 *
 * const result1 = safeParseJSON('{"valid": true}');
 * console.log(result1.value); // { valid: true }
 *
 * const result2 = safeParseJSON('invalid json');
 * console.log(result2.error); // SyntaxError
 * ```
 */
export function fromThrowable<Args extends unknown[], T>(
  fn: (...args: Args) => T
): (...args: Args) => Result<T, Error> {
  return (...args: Args): Result<T, Error> => {
    try {
      return ok(fn(...args));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

/**
 * Fluent API for Result type
 *
 * Provides chainable methods for functional composition.
 *
 * @example
 * ```typescript
 * const result = ResultWrapper.from(ok(5))
 *   .map(x => x * 2)
 *   .andThen(x => x > 5 ? ok(x) : err('too small'))
 *   .mapErr(e => `Error: ${e}`)
 *   .unwrapOr(0);
 *
 * console.log(result); // 10
 * ```
 */
export class ResultWrapper<T, E> {
  constructor(private result: Result<T, E>) {}

  static from<T, E>(result: Result<T, E>): ResultWrapper<T, E> {
    return new ResultWrapper(result);
  }

  isOk(): boolean {
    return this.result.ok;
  }

  isErr(): boolean {
    return !this.result.ok;
  }

  unwrap(): T {
    return unwrap(this.result);
  }

  unwrapOr(defaultValue: T): T {
    return unwrapOr(this.result, defaultValue);
  }

  map<U>(fn: (value: T) => U): ResultWrapper<U, E> {
    return new ResultWrapper(map(this.result, fn));
  }

  mapErr<F>(fn: (error: E) => F): ResultWrapper<T, F> {
    return new ResultWrapper(mapErr(this.result, fn));
  }

  andThen<U>(fn: (value: T) => Result<U, E>): ResultWrapper<U, E> {
    return new ResultWrapper(andThen(this.result, fn));
  }

  get(): Result<T, E> {
    return this.result;
  }
}

/**
 * Migration Guide: From try-catch to Result
 *
 * ## Before (try-catch):
 * ```typescript
 * async function fetchUser(id: string): Promise<User> {
 *   try {
 *     const response = await fetch(`/api/users/${id}`);
 *     if (!response.ok) {
 *       throw new Error(`HTTP ${response.status}`);
 *     }
 *     return await response.json();
 *   } catch (error) {
 *     console.error('Failed to fetch user:', error);
 *     throw error;
 *   }
 * }
 *
 * // Usage
 * try {
 *   const user = await fetchUser('123');
 *   console.log(user.name);
 * } catch (error) {
 *   console.error('Error:', error);
 * }
 * ```
 *
 * ## After (Result):
 * ```typescript
 * async function fetchUser(id: string): Promise<Result<User, Error>> {
 *   const response = await fromPromise(fetch(`/api/users/${id}`));
 *   if (!response.ok) return response;
 *
 *   if (!response.value.ok) {
 *     return err(new Error(`HTTP ${response.value.status}`));
 *   }
 *
 *   return fromPromise(response.value.json());
 * }
 *
 * // Usage
 * const result = await fetchUser('123');
 * if (result.ok) {
 *   console.log(result.value.name);
 * } else {
 *   console.error('Error:', result.error);
 * }
 * ```
 *
 * ## Benefits:
 * - Explicit error handling (no hidden control flow)
 * - Type-safe error propagation
 * - Composable with functional patterns
 * - No try-catch nesting
 *
 * ## Best Practices:
 * 1. Use Result for expected errors (validation, network, etc.)
 * 2. Use exceptions for unexpected errors (bugs, assertions)
 * 3. Prefer functional composition (map, andThen) over imperative checks
 * 4. Use fromPromise/fromThrowable to wrap existing APIs
 */
