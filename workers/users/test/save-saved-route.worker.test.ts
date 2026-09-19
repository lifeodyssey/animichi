import type { SaveSavedRouteInput } from "@animichi/contract";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import type { UsersPrisma } from "../src/db/prisma";
import { fakeUsersPrisma, unreachableUsersPrisma, type FakeSavedRouteRow } from "./fake-users-prisma";

const ID = "00000000-0000-4000-8000-000000000009";
const UNKNOWN = "00000000-0000-4000-8000-000000000008";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };

function repo(prisma: UsersPrisma): SavedRouteStore {
  return new NeonSavedRouteStore(prisma);
}

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: ["p1"],
    status: "saved", saved_at: null, updated_at: NOW, ...overrides,
  };
}

async function errorFor(
  input: SaveSavedRouteInput,
  store: ReturnType<typeof fakeUsersPrisma>,
): Promise<ORPCError<string, unknown>> {
  try {
    await saveSavedRoute(repo(store.prisma), "user-a", input, FIXED_NOW);
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected saveSavedRoute to reject");
}

describe("SaveSavedRoute creates a route", () => {
  it("makes exactly one authenticated insert", async () => {
    const store = fakeUsersPrisma();
    const route = await saveSavedRoute(
      repo(store.prisma), "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW,
    );
    expect(store.queries).toHaveLength(1);
    // The insert's net effect is one persisted saved-route row for the caller.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ user_id: "user-a", title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
  });

  it("stamps saved_at now for a saved route", async () => {
    const route = await saveSavedRoute(
      repo(fakeUsersPrisma().prisma), "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW,
    );
    expect(route.saved_at).toBe(NOW);
  });

  it("leaves saved_at null for a draft", async () => {
    const route = await saveSavedRoute(
      repo(fakeUsersPrisma().prisma), "user-a", { title: "Draft", point_ids: [], status: "draft" }, FIXED_NOW,
    );
    expect(route.saved_at).toBeNull();
  });
});

describe("SaveSavedRoute updates an owned route", () => {
  it("does one ownership read then one authenticated update", async () => {
    const store = fakeUsersPrisma([row()]);
    await saveSavedRoute(repo(store.prisma), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    // One ownership read then one authenticated update: the owned row is rewritten.
    expect(store.queries).toHaveLength(2);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("returns the updated row", async () => {
    const { prisma } = fakeUsersPrisma([row()]);
    const route = await saveSavedRoute(repo(prisma), "user-a", {
      id: ID, title: "Renamed", point_ids: ["p2"], status: "saved",
    }, FIXED_NOW);
    expect(route).toMatchObject({ id: ID, title: "Renamed", point_ids: ["p2"], status: "saved" });
  });

  it("preserves the previous saved_at for a non-draft status", async () => {
    const previous = "2026-07-12T00:00:00.000Z";
    const { prisma } = fakeUsersPrisma([row({ saved_at: previous })]);
    const route = await saveSavedRoute(repo(prisma), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(route.saved_at).toBe(previous);
  });

  it("stamps saved_at now when a null non-draft is updated", async () => {
    const { prisma } = fakeUsersPrisma([row({ status: "saved", saved_at: null })]);
    const route = await saveSavedRoute(repo(prisma), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "completed",
    }, FIXED_NOW);
    expect(route.saved_at).toBe(NOW);
  });

  it("clears saved_at when the route moves to draft", async () => {
    const { prisma } = fakeUsersPrisma([row({ status: "saved", saved_at: "2026-07-12T00:00:00.000Z" })]);
    const route = await saveSavedRoute(repo(prisma), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "draft",
    }, FIXED_NOW);
    expect(route.saved_at).toBeNull();
  });

  it("scopes the update to the owning user", async () => {
    // The fake evaluates the UPDATE's WHERE against the stored rows, so a
    // successful rewrite of the owner's row proves the write path is user-scoped.
    const store = fakeUsersPrisma([row()]);
    const route = await saveSavedRoute(repo(store.prisma), "user-a", {
      id: ID, title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ id: ID, user_id: "user-a", title: "Tokyo" });
    expect(route).toMatchObject({ id: ID, title: "Tokyo" });
  });
});

describe("SaveSavedRoute rejects unauthorized or failed writes", () => {
  it("returns SAVED_ROUTE_NOT_FOUND for an unknown id", async () => {
    const error = await errorFor({ id: UNKNOWN, title: "X", point_ids: [], status: "saved" }, fakeUsersPrisma());
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_FOUND", status: 404, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for another user's route", async () => {
    const store = fakeUsersPrisma([row({ user_id: "user-b" })]);
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, store);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED for an unclaimed route with no owner", async () => {
    const store = fakeUsersPrisma([row({ user_id: null })]);
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, store);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("returns SAVED_ROUTE_NOT_OWNED when the update loses the race", async () => {
    const store = fakeUsersPrisma([row()], {
      beforePlan: (index) => { if (index === 1) store.rows.length = 0; },
    });
    const error = await errorFor({ id: ID, title: "X", point_ids: [], status: "saved" }, store);
    expect(error).toMatchObject({ code: "SAVED_ROUTE_NOT_OWNED", status: 403, defined: true });
  });

  it("propagates a persistence failure", async () => {
    // A failed request must surface to the caller — never rewritten into a
    // domain error or swallowed. The rejection is raised at the execution seam,
    // so it propagates exactly as a real driver failure would.
    await expect(saveSavedRoute(repo(unreachableUsersPrisma()), "user-a", {
      title: "X", point_ids: [], status: "saved",
    })).rejects.toThrow("the Prisma seam should not be reached");
  });
});
