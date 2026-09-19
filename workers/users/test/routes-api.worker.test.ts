import type { SaveSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { listSavedRoutes as listSavedRoutesAction } from "../src/application/list-saved-routes";
import { saveSavedRoute } from "../src/application/save-saved-route";
import { fakeUsersPrisma, type FakeSavedRouteRow, type FakeUsersPrisma } from "./fake-users-prisma";

const ID = "00000000-0000-4000-8000-000000000009";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };
const UPDATE_INPUT: SaveSavedRouteInput = {
  id: ID, title: "X", point_ids: [], status: "saved",
};

type Seam = FakeUsersPrisma["prisma"];

/** Real Neon adapter over the in-memory Prisma seam. */
function repo(prisma: Seam): NeonSavedRouteRepo {
  return new NeonSavedRouteRepo(prisma);
}

/** The write-role adapter split (USERS-2 review: ≤50-line classes). */
function store(prisma: Seam): NeonSavedRouteStore {
  return new NeonSavedRouteStore(prisma);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: NOW, updated_at: NOW, ...overrides,
  };
}

async function caught(
  input: SaveSavedRouteInput, prisma: Seam = fakeUsersPrisma([row({ user_id: "user-b" })]).prisma,
): Promise<ORPCError<string, unknown>> {
  try {
    await saveSavedRoute(store(prisma), "user-a", input, FIXED_NOW);
  } catch (error) {
    return orpcError(error);
  }
  throw new Error("expected saveSavedRoute to reject");
}

function orpcError(error: unknown): ORPCError<string, unknown> {
  expect(error).toBeInstanceOf(ORPCError);
  return error as ORPCError<string, unknown>;
}

describe("user saved-route handlers", () => {
  it("lists an empty store through the ListSavedRoutes action", async () => {
    expect(await listSavedRoutesAction(repo(fakeUsersPrisma().prisma), "user-a")).toEqual({ saved_routes: [] });
  });

  it("creates a saved route with normalized timestamps", async () => {
    const result = await saveSavedRoute(store(fakeUsersPrisma().prisma), "user-a", {
      title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(result).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(result.saved_at).toBe(NOW);
    expect(result.updated_at).toBe(NOW);
  });

  it("creates a draft with no saved timestamp", async () => {
    const result = await saveSavedRoute(store(fakeUsersPrisma().prisma), "user-a", {
      title: "Draft", point_ids: [], status: "draft",
    }, FIXED_NOW);
    expect(result.saved_at).toBeNull();
  });

  it("throws SAVED_ROUTE_NOT_FOUND for an unknown update id", async () => {
    const error = await caught({ id: "00000000-0000-4000-8000-000000000008", title: "X", point_ids: [], status: "saved" });
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("throws SAVED_ROUTE_NOT_OWNED for another user's saved route", async () => {
    const error = await caught({ id: ID, title: "X", point_ids: [], status: "saved" });
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("updates an owned saved route and returns the updated row", async () => {
    const { prisma } = fakeUsersPrisma([row()]);
    const result = await saveSavedRoute(store(prisma), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    expect(result).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("normalizes raw workerd timestamp strings while listing", async () => {
    const seeded = row({ saved_at: "2026-07-13 12:34:56+00", updated_at: "2026-07-13 12:34:56+00" });
    const result = await listSavedRoutesAction(repo(fakeUsersPrisma([seeded]).prisma), "user-a");
    expect(result.saved_routes[0]?.saved_at).toBe("2026-07-13T12:34:56.000Z");
    expect(result.saved_routes[0]?.updated_at).toBe("2026-07-13T12:34:56.000Z");
  });
});

describe("atomic saved-route updates", () => {
  it("throws SAVED_ROUTE_NOT_OWNED when an owned update loses the race", async () => {
    const store0 = fakeUsersPrisma([row()], {
      // The row is dropped after the ownership read authorises it and before
      // the owner-predicated UPDATE runs, so the UPDATE matches nothing.
      beforePlan: (index) => { if (index === 1) store0.rows.length = 0; },
    });
    const error = await caught(UPDATE_INPUT, store0.prisma);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("scopes the atomic update to the owning user", async () => {
    // The fake evaluates the UPDATE's WHERE against the stored rows, so
    // rewriting the owner's row proves the update path is user-scoped.
    const seeded = fakeUsersPrisma([row()]);
    const result = await saveSavedRoute(store(seeded.prisma), "user-a", UPDATE_INPUT, FIXED_NOW);
    expect(seeded.rows).toHaveLength(1);
    expect(seeded.rows[0]).toMatchObject({ id: ID, user_id: "user-a", title: "X" });
    expect(result).toMatchObject({ id: ID, title: "X" });
  });

  it("leaves another user's row untouched", async () => {
    const seeded = fakeUsersPrisma([row({ user_id: "user-b" })]);
    await caught(UPDATE_INPUT, seeded.prisma);
    expect(seeded.rows[0]).toMatchObject({ id: ID, user_id: "user-b", title: "Tokyo" });
  });
});
