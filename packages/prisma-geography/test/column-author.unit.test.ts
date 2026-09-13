import assert from "node:assert/strict";
import { test } from "node:test";
import { geography } from "../src/geography/column-types.ts";

void test("geography authors an SRID-constrained column", () => {
  assert.deepEqual(geography({ srid: 4326 }), {
    codecId: "pg/geography@1",
    nativeType: "geography",
    typeParams: { srid: 4326 },
  });
});

void test("geography rejects a non-integer SRID", () => {
  assert.throws(() => geography({ srid: 4326.5 }), /non-negative integer/);
});

void test("geography rejects a negative SRID", () => {
  assert.throws(() => geography({ srid: -1 }), /non-negative integer/);
});
