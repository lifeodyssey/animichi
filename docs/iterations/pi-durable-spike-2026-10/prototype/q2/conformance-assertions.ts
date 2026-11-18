/**
 * pi-durable's `StorageConformanceAssertions` on `node:assert`, with the semantics of the Vitest matchers that
 * pi-durable's own adapter maps them to (`@earendil-works/pi-durable@1.5.2 dist/testing/assertions.js:5-21`):
 * `toBeTruthy`, `toBe` (Object.is), `toEqual` (recursive; undefined properties and object types ignored),
 * `toMatchObject` (only the expected keys; arrays of equal length), `toBeGreaterThan`, and `rejects.toThrow(substring)`.
 * `registerStorageConformance` needs a Vitest/Jest runner (`dist/testing/runner.d.ts:3-9`); this lets `node:test` run
 * the same cases through `createStorageConformance`.
 */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { StorageConformanceAssertions } from "@earendil-works/pi-durable/testing";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)
    && !(value instanceof Date) && !(value instanceof RegExp) && !(value instanceof Map) && !(value instanceof Set) && !(value instanceof Error);
}

/** `toEqual`'s view of a value: undefined properties dropped, arrays dense, any class read as its own properties. */
function equalView(value: unknown): unknown {
  if (value instanceof Error) return { error: String(value) };
  if (Array.isArray(value)) return Array.from(value, equalView);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, equalView(item)]));
}

/** `toMatchObject`: every expected key present and matching, recursively; an expected array matches element by element. */
function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matches(actual[index], item));
  }
  if (isRecord(expected)) {
    return isRecord(actual) && Object.entries(expected).every(([key, item]) => key in actual && matches(actual[key], item));
  }
  return isDeepStrictEqual(equalView(actual), equalView(expected));
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const nodeAssertions: StorageConformanceAssertions = {
  ok(value, message) {
    assert.ok(value, message);
  },
  strictEqual(actual, expected) {
    assert.strictEqual(actual, expected);
  },
  deepEqual(actual, expected) {
    assert.deepStrictEqual(equalView(actual), equalView(expected));
  },
  partialDeepEqual(actual, expected) {
    assert.ok(matches(actual, expected), `expected ${preview(actual)} to match ${preview(expected)}`);
  },
  greaterThan(actual, expected) {
    assert.ok(actual > expected, `expected ${String(actual)} to be greater than ${String(expected)}`);
  },
  async rejects(operation, messageIncludes) {
    await assert.rejects(operation, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(message.includes(messageIncludes), `expected a rejection including ${preview(messageIncludes)}, got ${preview(message)}`);
      return true;
    });
  },
};
