// FORBIDDEN: the two surfaces that put SQL the builder never saw into a query.
import { RawExpr, param } from "@prisma/orm-postgres/relational-core";

export async function listRows(db: any, id: string): Promise<unknown> {
  // ruleid: ts-no-prisma-raw-escape
  return await db.raw.sql`SELECT * FROM anime WHERE id = ${id}`.returnsRow({}).build();
}

export function stamp(seconds: number): RawExpr {
  // ruleid: ts-no-prisma-raw-escape
  return new RawExpr({
    parts: ["now() + make_interval(secs => ", param(seconds, { codecId: "pg/int4@1" }), ")"],
    returns: { codecId: "pg/timestamptz-string@1", nullable: false },
  });
}
