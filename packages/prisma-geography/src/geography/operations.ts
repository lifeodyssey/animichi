import { buildOperation, codecOf, toExpr } from "@prisma/orm-postgres/relational-core/expression";
import { GEOGRAPHY_CODEC_ID } from "./constants.ts";

const FLOAT8_CODEC_ID = "pg/float8@1";
const FLOAT4_CODEC_ID = "pg/float4@1"; // pg_trgm similarity() returns PostgreSQL real.
const BOOL_CODEC_ID = "pg/bool@1";
const TEXT_CODEC_ID = "pg/text@1";
const GEOGRAPHY_SELF = { codecId: GEOGRAPHY_CODEC_ID } as const;
const TEXT_SELF = { codecId: TEXT_CODEC_ID } as const;

interface BinaryOperationShape<Returns extends string> {
  readonly method: string;
  readonly self: unknown;
  readonly other: unknown;
  readonly returns: Returns;
  readonly strategy: "function" | "infix";
  readonly template: string;
}

function binaryOperation<Returns extends string>(shape: BinaryOperationShape<Returns>) {
  const codec = codecOf(shape.self);
  return buildOperation<{ codecId: Returns; nullable: false }>({
    method: shape.method,
    args: [toExpr(shape.self, codec), toExpr(shape.other, codec)],
    returns: { codecId: shape.returns, nullable: false },
    lowering: { targetFamily: "sql", strategy: shape.strategy, template: shape.template },
  });
}

function dwithinMeters(self: unknown, other: unknown, meters: unknown) {
  const geographyCodec = codecOf(self);
  assertMeters(meters);
  return buildOperation<{ codecId: typeof BOOL_CODEC_ID; nullable: false }>({
    method: "dwithinMeters",
    args: [toExpr(self, geographyCodec), toExpr(other, geographyCodec), toExpr(meters, { codecId: FLOAT8_CODEC_ID })],
    returns: { codecId: BOOL_CODEC_ID, nullable: false },
    lowering: { targetFamily: "sql", strategy: "function", template: "ST_DWithin({{self}}, {{arg0}}, {{arg1}})" },
  });
}

function assertMeters(value: unknown): void {
  if (isExpression(value)) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("dwithinMeters: meters must be a finite non-negative number");
  }
}

function isExpression(value: unknown): value is { readonly buildAst: () => unknown } {
  return typeof value === "object" && value !== null && "buildAst" in value && typeof value.buildAst === "function";
}

function distanceMeters(self: unknown, other: unknown) {
  return binaryOperation({
    method: "distanceMeters",
    self,
    other,
    returns: FLOAT8_CODEC_ID,
    strategy: "function",
    template: "ST_Distance({{self}}, {{arg0}})",
  });
}

function knnOrder(self: unknown, other: unknown) {
  return binaryOperation({
    method: "knnOrder",
    self,
    other,
    returns: FLOAT8_CODEC_ID,
    strategy: "infix",
    template: "{{self}} <-> {{arg0}}",
  });
}

function trigramSimilarity(self: unknown, query: unknown) {
  return binaryOperation({
    method: "trigramSimilarity",
    self,
    other: query,
    returns: FLOAT4_CODEC_ID,
    strategy: "function",
    template: "similarity({{self}}, {{arg0}})",
  });
}

function trigramMatches(self: unknown, query: unknown) {
  return binaryOperation({
    method: "trigramMatches",
    self,
    other: query,
    returns: BOOL_CODEC_ID,
    strategy: "infix",
    template: "({{self}} % {{arg0}})",
  });
}

export function packQueryOperations() {
  return {
    dwithinMeters: { self: GEOGRAPHY_SELF, impl: dwithinMeters },
    distanceMeters: { self: GEOGRAPHY_SELF, impl: distanceMeters },
    knnOrder: { self: GEOGRAPHY_SELF, impl: knnOrder },
    trigramSimilarity: { self: TEXT_SELF, impl: trigramSimilarity },
    trigramMatches: { self: TEXT_SELF, impl: trigramMatches },
  };
}
