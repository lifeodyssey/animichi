import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationExpr } from "@prisma/orm-postgres/relational-core/ast";
import { geographyQueryOperations } from "../src/geography/operations.ts";

const location = {
  codec: { codecId: "pg/geography@1", typeParams: { srid: 4326 } },
  buildAst: () => ({ kind: "test-location" }),
};
const other = { type: "Point", coordinates: [139.7671, 35.6812], srid: 4326 } as const;

void test("dwithinMeters lowers to the metre-native PostGIS function", () => {
  const expression = geographyQueryOperations().dwithinMeters.impl(location, other, 30_000);
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
  assert.throws(() => geographyQueryOperations().dwithinMeters.impl(location, other, -1), /finite non-negative number/u);
});

void test("dwithinMeters rejects a non-finite raw radius", () => {
  assert.throws(() => geographyQueryOperations().dwithinMeters.impl(location, other, Number.POSITIVE_INFINITY), /finite non-negative number/u);
});

void test("dwithinMeters preserves expression-valued radii", () => {
  const meters = { buildAst: () => ({ kind: "test-meters" }) };
  const operation = geographyQueryOperations().dwithinMeters.impl(location, other, meters).buildAst() as OperationExpr;
  assert.deepEqual(operation.args[1], { kind: "test-meters" });
});

void test("distanceMeters returns a non-null float8", () => {
  const expression = geographyQueryOperations().distanceMeters.impl(location, other);
  const operation = expression.buildAst();
  assert.equal(operation.kind, "operation");
  assert.equal(operation.lowering.template, "ST_Distance({{self}}, {{arg0}})");
  assert.deepEqual(operation.returns, { codecId: "pg/float8@1", nullable: false });
});

void test("knnOrder uses the true KNN infix operator", () => {
  const expression = geographyQueryOperations().knnOrder.impl(location, other);
  const operation = expression.buildAst();
  assert.equal(operation.kind, "operation");
  assert.deepEqual(operation.lowering, {
    targetFamily: "sql",
    strategy: "infix",
    template: "{{self}} <-> {{arg0}}",
  });
});
