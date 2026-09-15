import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationExpr } from "@prisma/orm-postgres/relational-core/ast";
import { packQueryOperations } from "../src/geography/operations.ts";

const location = {
  codec: { codecId: "pg/geography@1", typeParams: { srid: 4326 } },
  buildAst: () => ({ kind: "test-location" }),
};
const other = { type: "Point", coordinates: [139.7671, 35.6812], srid: 4326 } as const;
const name = {
  codec: { codecId: "pg/text@1" },
  buildAst: () => ({ kind: "test-name" }),
};

void test("dwithinMeters lowers to the metre-native PostGIS function", () => {
  const expression = packQueryOperations().dwithinMeters.impl(location, other, 30_000);
  const operation = expression.buildAst();
  assert.equal(operation.kind, "operation");
  assert.deepEqual(operation.lowering, {
    targetFamily: "sql",
    strategy: "function",
    template: "ST_DWithin({{self}}, {{arg0}}, {{arg1}})",
  });
  assert.deepEqual(operation.returns, { codecId: "pg/bool@1", nullable: false });
});

void test("dwithinMeters rejects a negative raw radius", () => {
  assert.throws(() => packQueryOperations().dwithinMeters.impl(location, other, -1), /finite non-negative number/u);
});

void test("dwithinMeters rejects a non-finite raw radius", () => {
  assert.throws(() => packQueryOperations().dwithinMeters.impl(location, other, Number.POSITIVE_INFINITY), /finite non-negative number/u);
});

void test("dwithinMeters preserves expression-valued radii", () => {
  const meters = { buildAst: () => ({ kind: "test-meters" }) };
  const operation = packQueryOperations().dwithinMeters.impl(location, other, meters).buildAst() as OperationExpr;
  assert.deepEqual(operation.args[1], { kind: "test-meters" });
});

void test("distanceMeters returns a non-null float8", () => {
  const expression = packQueryOperations().distanceMeters.impl(location, other);
  const operation = expression.buildAst();
  assert.equal(operation.kind, "operation");
  assert.equal(operation.lowering.template, "ST_Distance({{self}}, {{arg0}})");
  assert.deepEqual(operation.returns, { codecId: "pg/float8@1", nullable: false });
});

void test("knnOrder uses the true KNN infix operator", () => {
  const expression = packQueryOperations().knnOrder.impl(location, other);
  const operation = expression.buildAst();
  assert.equal(operation.kind, "operation");
  assert.deepEqual(operation.lowering, {
    targetFamily: "sql",
    strategy: "infix",
    template: "{{self}} <-> {{arg0}}",
  });
});

void test("trigramSimilarity lowers to the similarity function", () => {
  const operation = packQueryOperations().trigramSimilarity.impl(name, "shibuya").buildAst();
  assert.equal(operation.kind, "operation");
  assert.deepEqual(operation.lowering, {
    targetFamily: "sql",
    strategy: "function",
    template: "similarity({{self}}, {{arg0}})",
  });
  assert.deepEqual(operation.returns, { codecId: "pg/float4@1", nullable: false });
});

void test("trigramMatches lowers to the pg_trgm match operator", () => {
  const operation = packQueryOperations().trigramMatches.impl(name, "shibuya").buildAst();
  assert.equal(operation.kind, "operation");
  assert.deepEqual(operation.lowering, {
    targetFamily: "sql",
    strategy: "infix",
    template: "({{self}} % {{arg0}})",
  });
  assert.deepEqual(operation.returns, { codecId: "pg/bool@1", nullable: false });
});
