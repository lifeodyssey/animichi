import { buildOperation, codecOf, toExpr } from "@prisma/orm-postgres/relational-core/expression";
import { GEOGRAPHY_CODEC_ID } from "./constants.ts";

const FLOAT8_CODEC_ID = "pg/float8@1";
const BOOL_CODEC_ID = "pg/bool@1";
const GEOGRAPHY_SELF = { codecId: GEOGRAPHY_CODEC_ID } as const;

function binaryOperation(method: string, self: unknown, other: unknown, returns: string, template: string, strategy: "function" | "infix") {
  const geographyCodec = codecOf(self);
  return buildOperation({
    method,
    args: [toExpr(self, geographyCodec), toExpr(other, geographyCodec)],
    returns: { codecId: returns, nullable: false },
    lowering: { targetFamily: "sql", strategy, template },
  });
}

function dwithinMeters(self: unknown, other: unknown, meters: unknown) {
  const geographyCodec = codecOf(self);
  return buildOperation({
    method: "dwithinMeters",
    args: [toExpr(self, geographyCodec), toExpr(other, geographyCodec), toExpr(meters, { codecId: FLOAT8_CODEC_ID })],
    returns: { codecId: BOOL_CODEC_ID, nullable: false },
    lowering: { targetFamily: "sql", strategy: "function", template: "ST_DWithin({{self}}, {{arg0}}, {{arg1}})" },
  });
}

function distanceMeters(self: unknown, other: unknown) {
  return binaryOperation("distanceMeters", self, other, FLOAT8_CODEC_ID, "ST_Distance({{self}}, {{arg0}})", "function");
}

function knnOrder(self: unknown, other: unknown) {
  return binaryOperation("knnOrder", self, other, FLOAT8_CODEC_ID, "{{self}} <-> {{arg0}}", "infix");
}

export function geographyQueryOperations() {
  return {
    dwithinMeters: { self: GEOGRAPHY_SELF, impl: dwithinMeters },
    distanceMeters: { self: GEOGRAPHY_SELF, impl: distanceMeters },
    knnOrder: { self: GEOGRAPHY_SELF, impl: knnOrder },
  };
}
