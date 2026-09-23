// FORBIDDEN, form 2 of 2: a hand-built `RawExpr`, whose `parts` are RENDERED as
// SQL text rather than bound.
//
// Alone in its own file for the reason given in `ts-prisma-raw-query-lane.ts`.
import { RawExpr, param } from "@prisma/orm-postgres/relational-core";

export function stamp(seconds: number): RawExpr {
  // ruleid: ts-no-prisma-raw-escape
  return new RawExpr({
    parts: ["now() + make_interval(secs => ", param(seconds, { codecId: "pg/int4@1" }), ")"],
    returns: { codecId: "pg/timestamptz-string@1", nullable: false },
  });
}
