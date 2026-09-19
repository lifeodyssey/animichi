import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import type { SavedRouteStore } from "../src/application/save-saved-route";
import { fakeUsersPrisma, type FakeSavedRouteRow } from "./fake-users-prisma";

const ID = "00000000-0000-4000-8000-000000000009";
const OTHER_ID = "00000000-0000-4000-8000-00000000000b";
const NOW = "2026-07-13T04:00:00.000Z";
const FIXED_NOW = { now: () => NOW };

function row(overrides: Partial<FakeSavedRouteRow> = {}): FakeSavedRouteRow {
  return {
    id: ID, user_id: "user-a", title: "Tokyo", point_ids: [],
    status: "saved", saved_at: null, updated_at: NOW, ...overrides,
  };
}

describe("NeonSavedRouteRepo over the request's Prisma access", () => {
  it("reads owned saved routes through listOwned", async () => {
    const repo = new NeonSavedRouteRepo(fakeUsersPrisma([row()]).prisma);
    expect((await repo.listOwned("user-a")).map((route) => route.id)).toEqual([ID]);
  });

  it("never returns another user's rows", async () => {
    const store = fakeUsersPrisma([row(), row({ id: OTHER_ID, user_id: "user-b" })]);
    const repo = new NeonSavedRouteRepo(store.prisma);
    expect((await repo.listOwned("user-a")).map((route) => route.id)).toEqual([ID]);
  });

  it("creates a saved route through the action and returns the normalized row", async () => {
    const repo: SavedRouteStore = new NeonSavedRouteStore(fakeUsersPrisma().prisma);
    const route = await saveSavedRoute(repo, "user-a", { title: "Tokyo", point_ids: ["p1"], status: "saved" }, FIXED_NOW);
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(route.saved_at).toBe(NOW);
  });

  it("leaves the identifier to the database's uuidv7() default", async () => {
    // The fake refuses an INSERT that supplies saved_routes.id, so a regression
    // that mints one in application code fails here as well as on the real
    // database (test/saved-route-id.integration.test.ts).
    const store = fakeUsersPrisma();
    const route = await saveSavedRoute(new NeonSavedRouteStore(store.prisma), "user-a", {
      title: "Tokyo", point_ids: ["p1"], status: "saved",
    }, FIXED_NOW);
    expect(route.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("saved-route row policy at the boundary", () => {
  it("reads a null title as an empty string", async () => {
    const store = fakeUsersPrisma([row({ title: null, point_ids: ["p1"] })]);
    const repo = new NeonSavedRouteRepo(store.prisma);
    expect((await repo.listOwned("user-a"))[0]?.title).toBe("");
  });

  it("normalizes a raw Postgres timestamptz to ISO", async () => {
    const store = fakeUsersPrisma([row({ saved_at: "2026-07-13 12:34:56+00", updated_at: "2026-07-13 12:34:56+00" })]);
    const repo = new NeonSavedRouteRepo(store.prisma);
    const [listed] = await repo.listOwned("user-a");
    expect(listed?.saved_at).toBe("2026-07-13T12:34:56.000Z");
    expect(listed?.updated_at).toBe("2026-07-13T12:34:56.000Z");
  });

  it("rejects a status outside the domain's union", async () => {
    const store = fakeUsersPrisma([row({ status: "bogus" })]);
    const repo = new NeonSavedRouteRepo(store.prisma);
    await expect(repo.listOwned("user-a")).rejects.toThrow("invalid saved route row");
  });
});

describe("findOwner", () => {
  it("returns undefined when no row matches", async () => {
    const store = new NeonSavedRouteStore(fakeUsersPrisma().prisma);
    await expect(store.findOwner("r-none")).resolves.toBeUndefined();
  });

  it("carries the owner and the saved_at the update policy needs", async () => {
    const store = new NeonSavedRouteStore(fakeUsersPrisma([row({ saved_at: NOW })]).prisma);
    await expect(store.findOwner(ID)).resolves.toEqual({ userId: "user-a", savedAt: NOW });
  });

  it("reports an unclaimed row as ownerless rather than absent", async () => {
    const store = new NeonSavedRouteStore(fakeUsersPrisma([row({ user_id: null })]).prisma);
    await expect(store.findOwner(ID)).resolves.toEqual({ userId: null, savedAt: null });
  });
});
