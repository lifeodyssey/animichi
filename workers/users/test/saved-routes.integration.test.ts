import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { deleteSavedRoute } from "../src/application/delete-saved-route";
import { listSavedRoutes } from "../src/application/list-saved-routes";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { UsersPrisma } from "../src/db/prisma";
import { databaseDescribe, emptySavedRoutes, openUsersPrisma, type UsersSeam } from "./integration-db";

/**
 * AC1 (#1632): every user-data operation returns the same shapes and enforces
 * the same constraints as before, proved against a real database.
 *
 * What only a real database can answer, and therefore what this file is for:
 *
 * - `saved_routes.point_ids` is a `text[]`. The old contract bound the array as
 *   ONE parameter (`sql.param(arr)::text[]`) because interpolating a JS array
 *   expands to a tuple. The Prisma builder owns that binding now, and a
 *   round trip is the only proof it still binds the same way.
 * - `timestamptz` comes back as a `Date` under Node and as text under workerd.
 *   The wire shape must be ISO either way.
 * - the schema's CHECK constraints (`saved_routes_status`) and the composite
 *   primary key must still refuse what they refused before.
 */
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };
const ID = "00000000-0000-4000-8000-0000000000aa";
const UNKNOWN = "00000000-0000-4000-8000-0000000000ff";

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

/** Seed one owned route through the real store and return it. */
async function seed(userId: string, input: Parameters<typeof saveSavedRoute>[2]) {
  return saveSavedRoute(new NeonSavedRouteStore(seam.prisma), userId, input, FIXED_NOW);
}

const prisma = (): UsersPrisma => seam.prisma;

databaseDescribe("user data operations round-trip against real Postgres (#1632 AC1)", () => {
  it("creates and lists a saved route with the same shapes as before", async () => {
    const created = await seed("user-a", { title: "Tokyo", point_ids: ["p1", "p2"], status: "saved" });
    expect(created).toEqual({
      id: created.id, title: "Tokyo", point_ids: ["p1", "p2"],
      status: "saved", saved_at: NOW, updated_at: created.updated_at,
    });
    expect(created.saved_at).toBe(NOW);
    expect(Date.parse(created.updated_at)).not.toBeNaN();
    expect((await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes).toEqual([created]);
  });

  it("updates an owned route and deletes it", async () => {
    const created = await seed("user-a", { title: "Tokyo", point_ids: ["p1", "p2"], status: "saved" });
    const updated = await saveSavedRoute(
      new NeonSavedRouteStore(prisma()), "user-a",
      { id: created.id, title: "Renamed", point_ids: ["p2"], status: "completed" }, FIXED_NOW,
    );
    expect(updated).toMatchObject({ id: created.id, title: "Renamed", point_ids: ["p2"], status: "completed" });
    // A non-draft keeps the previous stamp rather than re-stamping.
    expect(updated.saved_at).toBe(NOW);

    await expect(deleteSavedRoute(new NeonSavedRouteStore(prisma()), "user-a", { id: created.id }))
      .resolves.toEqual({ deleted: true });
    expect((await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes).toEqual([]);
  });
});

databaseDescribe("the array and timestamp columns round-trip (#1632 AC1, spec U3)", () => {
  it("round-trips a text[] that no tuple expansion could survive", async () => {
    // The array's own braces and commas, an empty element and a quoted comma:
    // every shape a `($1,$2)` expansion or a naive split would corrupt.
    const pointIds = ["plain", "has,comma", "has{}braces", "", 'quote"inside', "unicode-東京"];
    const created = await seed("user-a", { title: "Arrays", point_ids: pointIds, status: "draft" });
    const [listed] = (await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes;
    expect(listed?.point_ids).toEqual(pointIds);
    expect(created.point_ids).toEqual(pointIds);
  });

  it("round-trips an empty text[]", async () => {
    const created = await seed("user-a", { title: "Empty", point_ids: [], status: "draft" });
    expect(created.point_ids).toEqual([]);
    expect((await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes[0]?.point_ids).toEqual([]);
  });

  it("stamps a draft with no saved_at and clears it on the way back", async () => {
    const draft = await seed("user-a", { title: "Draft", point_ids: [], status: "draft" });
    expect(draft.saved_at).toBeNull();
    const saved = await saveSavedRoute(new NeonSavedRouteStore(prisma()), "user-a", {
      id: draft.id, title: "Draft", point_ids: [], status: "saved",
    }, FIXED_NOW);
    expect(saved.saved_at).toBe(NOW);
    const back = await saveSavedRoute(new NeonSavedRouteStore(prisma()), "user-a", {
      id: draft.id, title: "Draft", point_ids: [], status: "draft",
    }, FIXED_NOW);
    expect(back.saved_at).toBeNull();
  });
});

databaseDescribe("the ownership boundary holds against real Postgres (#1632 AC1)", () => {
  it("scopes every read and write to the owner", async () => {
    const owned = await seed("user-a", { title: "A", point_ids: [], status: "saved" });
    // user-b can neither see it nor take it over, and the rejections are the
    // domain's own codes rather than a row-level side effect.
    await expect(saveSavedRoute(new NeonSavedRouteStore(prisma()), "user-b", {
      id: owned.id, title: "Stolen", point_ids: [], status: "saved",
    }, FIXED_NOW)).rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED" });
    await expect(deleteSavedRoute(new NeonSavedRouteStore(prisma()), "user-b", { id: owned.id }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED" });
    const [row] = (await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes;
    expect(row?.title).toBe("A");
  });

  it("reports an unknown route as missing, not as another user's", async () => {
    await expect(deleteSavedRoute(new NeonSavedRouteStore(prisma()), "user-a", { id: UNKNOWN }))
      .rejects.toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND" });
  });

  it("leaves an unclaimed row owned by nobody", async () => {
    await prisma().executor.query(prisma().builder.public.saved_routes.insert([{
      user_id: null, title: "Unclaimed", point_ids: [], status: "saved",
    }]).build());
    const [row] = (await listSavedRoutes(new NeonSavedRouteRepo(prisma()), "user-a")).saved_routes;
    expect(row).toBeUndefined();
    // The ownership read still sees it, and reports it as ownerless rather than absent.
    const rows = await prisma().executor.query(
      prisma().builder.public.saved_routes.select("id", "user_id").where((f, fns) => fns.eq(f.title, "Unclaimed")).build(),
    );
    expect(rows[0]?.user_id).toBeNull();
  });
});

databaseDescribe("the schema's own constraints still refuse what they refused (#1632 AC1)", () => {
  // The runtime normalizes a SQLSTATE failure into a `SqlQueryError` carrying
  // `sqlState` and `table`, which is the shape application code sees.
  it("rejects a status outside the CHECK constraint", async () => {
    const insert = prisma().builder.public.saved_routes.insert([{
      user_id: "user-a", title: "Bad", point_ids: [], status: "bogus",
    }]).build();
    await expect(prisma().executor.query(insert))
      .rejects.toMatchObject({ sqlState: "23514", table: "saved_routes" });
  });

  it("rejects a ledger state outside its CHECK constraint", async () => {
    const insert = prisma().builder.public.saved_route_idempotency.insert([{
      owner_user_id: "user-a", op: "saveSavedRoute", key: "k",
      fingerprint: "f", state: "bogus", expires_at: NOW,
    }]).build();
    await expect(prisma().executor.query(insert))
      .rejects.toMatchObject({ sqlState: "23514", table: "saved_route_idempotency" });
  });

  it("rejects a second ledger row for one composite key", async () => {
    const values = {
      owner_user_id: "user-a", op: "saveSavedRoute", key: "k", fingerprint: "f", expires_at: NOW,
    };
    await prisma().executor.query(prisma().builder.public.saved_route_idempotency.insert([values]).build());
    await expect(prisma().executor.query(prisma().builder.public.saved_route_idempotency.insert([values]).build()))
      .rejects.toMatchObject({ sqlState: "23505", table: "saved_route_idempotency" });
  });

  it("keeps a route's id unique", async () => {
    const insert = (id: string) => prisma().builder.public.saved_routes.insert([{
      id, user_id: "user-a", title: "T", point_ids: [], status: "saved",
    }]).build();
    await prisma().executor.query(insert(ID));
    await expect(prisma().executor.query(insert(ID)))
      .rejects.toMatchObject({ sqlState: "23505", table: "saved_routes" });
  });
});
