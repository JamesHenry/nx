type Comparer<T> = (a: T, b: T) => Comparison;

const enum Comparison {
  LessThan = -1,
  EqualTo = 0,
  GreaterThan = 1,
}

export function map<T, U>(array: readonly T[], f: (x: T, i: number) => U): U[];
export function map<T, U>(
  array: readonly T[] | undefined,
  f: (x: T, i: number) => U
): U[] | undefined;
export function map<T, U>(
  array: readonly T[] | undefined,
  f: (x: T, i: number) => U
): U[] | undefined {
  let result: U[] | undefined;
  if (array) {
    result = [];
    for (let i = 0; i < array.length; i++) {
      result.push(f(array[i], i));
    }
  }
  return result;
}

function some<T>(array: readonly T[] | undefined): array is readonly T[];
function some<T>(
  array: readonly T[] | undefined,
  predicate: (value: T) => boolean
): boolean;
function some<T>(
  array: readonly T[] | undefined,
  predicate?: (value: T) => boolean
): boolean {
  if (array) {
    if (predicate) {
      for (const v of array) {
        if (predicate(v)) {
          return true;
        }
      }
    } else {
      return array.length > 0;
    }
  }
  return false;
}

/**
 * Returns the last element of an array if non-empty, `undefined` otherwise.
 */
export function lastOrUndefined<T>(array: readonly T[]): T | undefined {
  return array.length === 0 ? undefined : array[array.length - 1];
}

export function length(array: readonly any[] | undefined): number {
  return array ? array.length : 0;
}

/**
 * Iterates through 'array' by index and performs the callback on each element of array until the callback
 * returns a truthy value, then returns that value.
 * If no such value is found, the callback is applied to each element of array and undefined is returned.
 */
export function forEach<T, U>(
  array: readonly T[] | undefined,
  callback: (element: T, index: number) => U | undefined
): U | undefined {
  if (array) {
    for (let i = 0; i < array.length; i++) {
      const result = callback(array[i], i);
      if (result) {
        return result;
      }
    }
  }
  return undefined;
}

/**
 * Performs a binary search, finding the index at which `value` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `value`.
 * @param array A sorted array whose first element must be no larger than number
 * @param value The value to be searched for in the array.
 * @param keySelector A callback used to select the search key from `value` and each element of
 * `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
export function binarySearch<T, U>(
  array: readonly T[],
  value: T,
  keySelector: (v: T) => U,
  keyComparer: Comparer<U>,
  offset?: number
): number {
  return binarySearchKey(
    array,
    keySelector(value),
    keySelector,
    keyComparer,
    offset
  );
}

/**
 * Performs a binary search, finding the index at which an object with `key` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `key`.
 * @param array A sorted array whose first element must be no larger than number
 * @param key The key to be searched for in the array.
 * @param keySelector A callback used to select the search key from each element of `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
function binarySearchKey<T, U>(
  array: readonly T[],
  key: U,
  keySelector: (v: T, i: number) => U,
  keyComparer: Comparer<U>,
  offset?: number
): number {
  if (!some(array)) {
    return -1;
  }

  let low = offset || 0;
  let high = array.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const midKey = keySelector(array[middle], middle);
    switch (keyComparer(midKey, key)) {
      case Comparison.LessThan:
        low = middle + 1;
        break;
      case Comparison.EqualTo:
        return middle;
      case Comparison.GreaterThan:
        high = middle - 1;
        break;
    }
  }

  return ~low;
}

/**
 * Tests whether a value is an array.
 */
export function isArray(value: any): value is readonly unknown[] {
  return Array.isArray ? Array.isArray(value) : value instanceof Array;
}

export function toArray<T>(value: T | T[]): T[];
export function toArray<T>(value: T | readonly T[]): readonly T[];
export function toArray<T>(value: T | T[]): T[] {
  return isArray(value) ? value : [value];
}

/** Does nothing. */
export function noop(_?: unknown): void {}

/** Returns its argument. */
export function identity<T>(x: T) {
  return x;
}

function compareComparableValues(
  a: string | undefined,
  b: string | undefined
): Comparison;
function compareComparableValues(
  a: number | undefined,
  b: number | undefined
): Comparison;
function compareComparableValues(
  a: string | number | undefined,
  b: string | number | undefined
) {
  return a === b
    ? Comparison.EqualTo
    : a === undefined
    ? Comparison.LessThan
    : b === undefined
    ? Comparison.GreaterThan
    : a < b
    ? Comparison.LessThan
    : Comparison.GreaterThan;
}

/**
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(
  a: number | undefined,
  b: number | undefined
): Comparison {
  return compareComparableValues(a, b);
}
