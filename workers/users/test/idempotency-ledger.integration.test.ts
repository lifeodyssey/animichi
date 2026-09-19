import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { SaveSavedRouteInput } from "@animichi/contract";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import type { UsersPrisma } from "../src/db/prisma";
import { canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { databaseDescribe, emptySavedRoutes, openUsersPrisma, type UsersSeam } from "./integration-db";

/**
 * AC2 (#1632): idempotent operations remain idempotent — a repeated request with
 * the same key produces one effect and the same response.
 *
 * It also settles **U2** of the parent spec (§十一), which this card is the first
 * to hit: `ON CONFLICT … DO UPDATE … WHERE` has no Prisma 8 expression. The
 * contract-bound builder has no `onConflict` member, and the contract-free
 * insert-on-conflict AST's `DoUpdateSetConflictAction` carries only a `set` —
 * there is nowhere to hang the staleness predicate. So `reclaim` is an UPDATE
 * whose own `WHERE` is the predicate, and the two-way assertion #1222 asked for
 * runs here against real Postgres: a stale row is reclaimable, a committed row
 * inside its retention window is not overwritable.
 */
const OP = "saveSavedRoute";
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const RETENTION_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT_MS = 10_000;
const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z

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

function save(input = INPUT, key = "k", now = NOW) {
  return saveSavedRouteIdempotent(
    new NeonAtomicCommitStore(prisma()), new NeonIdempotencyStore(prisma()),
    "user-a", input, key, { now: () => now },
  );
}

/** Write one ledger row directly, for the states a request cannot reach. */
async function seedLedger(overrides: Record<string, unknown>): Promise<void> {
  await prisma().executor.query(prisma().builder.public.saved_route_idempotency.insert([{
    owner_user_id: "user-a", op: OP, key: "k",
    fingerprint: canonicalFingerprint(INPUT), state: "in_progress",
    result: null, result_id: null,
    created_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + RETENTION_MS).toISOString(),
    ...overrides,
  }]).build());
}

async function countRoutes(): Promise<number> {
  return (await prisma().executor.query(prisma().builder.public.saved_routes.select("id").build())).length;
}

async function countLedger(): Promise<number> {
  const rows = await prisma().executor.query(
    prisma().builder.public.saved_route_idempotency.select("key").build(),
  );
  return rows.length;
}

databaseDescribe("a repeated request with the same key makes one effect (#1632 AC2)", () => {
  it("returns the same saved route for a repeat and creates one row", async () => {
    const first = await save();
    const second = await save();
    expect(second).toEqual(first);
    expect(await countRoutes()).toBe(1);
    expect(await countLedger()).toBe(1);
  });

  it("returns the same saved route when the retry arrives later, across isolates", async () => {
    // The first response was lost. The retry is a different request with a
    // different clock, and it must still replay rather than create.
    const first = await save();
    const retry = await save(INPUT, "k", NOW + 5_000);
    expect(retry).toEqual(first);
    expect(await countRoutes()).toBe(1);
  });

  it("collapses two concurrent duplicates into one route and one ledger row", async () => {
    const outcomes = await Promise.allSettled([save(), save()]);
    const created = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    expect(created.length).toBeGreaterThan(0);
    // Whoever lost the claim either replayed the winner's route or gave up with
    // the retryable 409 — never a second route.
    expect(new Set(created.map((route) => route.id)).size).toBe(1);
    expect(await countRoutes()).toBe(1);
    expect(await countLedger()).toBe(1);
  });

  it("rejects the same key with a different payload without touching the store", async () => {
    await save();
    await expect(save({ title: "Osaka", point_ids: ["p9"], status: "saved" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(await countRoutes()).toBe(1);
  });

  it("scopes one key string to its owner, so two users each create their own", async () => {
    const first = await save();
    const second = await saveSavedRouteIdempotent(
      new NeonAtomicCommitStore(prisma()), new NeonIdempotencyStore(prisma()),
      "user-b", INPUT, "k", { now: () => NOW },
    );
    expect(second.id).not.toBe(first.id);
    expect(await countRoutes()).toBe(2);
    expect(await countLedger()).toBe(2);
  });
});

databaseDescribe("reclaim's staleness predicate is evaluated against the row (#1632 AC2, spec U2)", () => {
  it("reclaims a row abandoned past its in-flight window", async () => {
    await seedLedger({
      created_at: new Date(NOW - IN_FLIGHT_MS - 1_000).toISOString(),
      // Not yet at retention: only the in-flight window has lapsed.
      expires_at: new Date(NOW + RETENTION_MS).toISOString(),
    });
    const route = await save();
    expect(route.id).toBeTruthy();
    expect(await countRoutes()).toBe(1);
  });

  it("REFUSES to overwrite a committed row inside its retention window", async () => {
    // The row the tautological predicate (#1222) silently overwrote: committed,
    // 20 s old — past the in-flight window, nowhere near its 24 h retention.
    const committed = await save();
    await prisma().executor.query(prisma().builder.public.saved_route_idempotency
      .update({ created_at: new Date(NOW - IN_FLIGHT_MS - 10_000).toISOString() })
      .where((fields, fns) => fns.eq(fields.key, "k"))
      .build());
    const replay = await save(INPUT, "k", NOW + 1_000);
    expect(replay).toEqual(committed);
    expect(await countRoutes()).toBe(1);
  });

  it("reclaims a committed row once its retention has actually elapsed", async () => {
    const first = await save();
    const second = await save(INPUT, "k", NOW + RETENTION_MS + 1);
    expect(second.id).not.toBe(first.id);
    expect(await countRoutes()).toBe(2);
  });

  it("lets exactly one of two racing reclaimers win a stale row", async () => {
    await seedLedger({
      created_at: new Date(NOW - IN_FLIGHT_MS - 1_000).toISOString(),
      expires_at: new Date(NOW + RETENTION_MS).toISOString(),
    });
    const outcomes = await Promise.allSettled([save(), save()]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409 });
    expect(await countRoutes()).toBe(1);
  });

  it("gives up with a typed retryable 409 on a row that never commits", async () => {
    await seedLedger({});
    await expect(save()).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409 });
    expect(await countRoutes()).toBe(0);
  });
});
