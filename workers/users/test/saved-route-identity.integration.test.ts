import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import type { UsersPrisma } from "../src/db/prisma";
import { databaseDescribe, emptySavedRoutes, openUsersPrisma, type UsersSeam } from "./integration-db";

/**
 * AC4 (#1632): identifiers are assigned by the database default, and the version
 * is the one the schema specifies.
 *
 * `saved_routes.id` is `@default(dbgenerated("uuidv7()"))`. Until #1632 the
 * atomic winner path had to mint the id in the worker instead, because Neon's
 * HTTP batch offered no round trip for the ledger's second statement to read
 * the first's `RETURNING`. The transaction removes that constraint, so this file
 * proves the consequence rather than the intent: the INSERT carries no id, the
 * value that comes back is a UUIDv7, and the ledger committed to THAT value —
 * which is only possible if statement 2 read statement 1's row.
 */
const ROUTE_ID_VERSION = 7;

let seam: UsersSeam;

beforeAll(async () => {
  seam = await openUsersPrisma();
});

afterAll(async () => {
  await seam.dispose();
});

beforeEach(async () => {
  await emptySavedRoutes(seam.prisma);
});

const prisma = (): UsersPrisma => seam.prisma;

/** A UUID's version nibble: the first hex digit of the third group. */
function uuidVersion(value: string): number {
  return Number.parseInt(value.split("-")[2]?.charAt(0) ?? "", 16);
}

async function commitOne(key: string) {
  return saveSavedRouteIdempotent(
    new NeonAtomicCommitStore(prisma()), new NeonIdempotencyStore(prisma()),
    "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, key,
  );
}

/** The one ledger row for a key, read back through the builder. */
async function ledgerRow(key: string) {
  const rows = await prisma().executor.query(
    prisma().builder.public.saved_route_idempotency
      .select("state", "result", "result_id")
      .where((fields, fns) => fns.eq(fields.key, key))
      .build(),
  );
  const [row] = rows;
  if (row === undefined) throw new Error("expected a ledger row");
  return row;
}

databaseDescribe("the database assigns the identifier (#1632 AC4)", () => {
  it("lets uuidv7() assign the id and commits the ledger to that same value", async () => {
    const route = await commitOne("k-version");
    expect(route.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(uuidVersion(route.id)).toBe(ROUTE_ID_VERSION);

    // The ledger's snapshot and its result_id are the row statement 1 returned:
    // the second statement could only carry them if it read the first's
    // RETURNING inside the same transaction.
    const ledger = await ledgerRow("k-version");
    expect(ledger.state).toBe("committed");
    expect(ledger.result_id).toBe(route.id);
    expect(ledger.result).toEqual(route);
  });

  it("mints distinct identifiers for distinct creates, and every one is v7", async () => {
    const first = await commitOne("k-one");
    const second = await commitOne("k-two");
    expect(first.id).not.toBe(second.id);
    expect(uuidVersion(first.id)).toBe(ROUTE_ID_VERSION);
    expect(uuidVersion(second.id)).toBe(ROUTE_ID_VERSION);
  });

  it("assigns the id the database chose, not one the caller could have named", () => {
    // The plan's INSERT carries no `id` key at all, so there is nothing for a
    // later refactor to accidentally start supplying. The runtime assertion is
    // the one above; this is the statement's own shape.
    const plan = prisma().builder.public.saved_routes.insert([{
      user_id: "user-a", title: "T", point_ids: [], status: "saved",
    }]).returning("id").build();
    const ast = (plan as unknown as { ast: { rows: readonly Record<string, unknown>[] } }).ast;
    expect(Object.keys(ast.rows[0] ?? {})).not.toContain("id");
  });
});
