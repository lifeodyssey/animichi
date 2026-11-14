import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { NeonSavedRouteRepo } from "../src/adapters/neon-saved-route-repo";
import { listSavedRoutes } from "../src/application/list-saved-routes";
import type { UsersPrisma } from "../src/db/prisma";
import { databaseDescribe, emptySavedRoutes, openUsersPrisma, type UsersSeam } from "./integration-db";

/**
 * SUT: the ListSavedRoutes read — `NeonSavedRouteRepo.listOwned` behind the
 * action — against real Postgres (ucm-M12). The order the database returns is
 * the order the client gets, so the statement's ORDER BY is the whole policy:
 * newest `updated_at` first, and equal timestamps fall back to `id`, newest
 * first, which makes the order total and repeatable.
 *
 * There is no page size. The contract's listSavedRoutes takes no input, and
 * apps/web finds a route in this list before it opens the route's detail page
 * (`src/routes/routes/$routeId.tsx`), so a LIMIT would turn an owned route into
 * a 404.
 *
 * Rows are inserted in the reverse of the expected order, so neither a missing
 * ORDER BY (heap order) nor a missing tie-break passes by accident.
 */
const OLDEST = "2026-07-13T04:00:00.000Z";
const TIED = "2026-07-13T05:00:00.000Z";
const NEWEST = "2026-07-13T06:00:00.000Z";
const MANY = 250;

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

/** A route id whose order is its number, the way uuidv7 ids sort by creation. */
function routeId(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

interface SeedRoute { readonly id: string; readonly updatedAt: string; readonly userId: string }

function route(id: string, updatedAt: string, userId = "user-a"): SeedRoute {
  return { id, updatedAt, userId };
}

/** Insert the routes in the order given, in one statement. The update trigger
 * fires on UPDATE only, so each row keeps the `updated_at` it is given. */
async function insertRoutes(routes: readonly SeedRoute[]): Promise<void> {
  await prisma().executor.query(prisma().builder.public.saved_routes.insert(routes.map((seeded) => ({
    id: seeded.id, user_id: seeded.userId, title: "T", point_ids: [], status: "saved", updated_at: seeded.updatedAt,
  }))).build());
}

async function listedIds(userId: string): Promise<string[]> {
  const { saved_routes } = await listSavedRoutes(new NeonSavedRouteRepo(prisma()), userId);
  return saved_routes.map((saved) => saved.id);
}

databaseDescribe("the database orders a caller's saved routes (ucm-M12)", () => {
  it("lists the newest update first and breaks a timestamp tie by the newest id", async () => {
    await insertRoutes([
      route(routeId(1), OLDEST),
      route(routeId(2), TIED),
      route(routeId(3), TIED),
      route(routeId(4), TIED),
      route(routeId(5), NEWEST),
    ]);
    expect(await listedIds("user-a")).toEqual([routeId(5), routeId(4), routeId(3), routeId(2), routeId(1)]);
  });

  it("returns the same order on every read of unchanged rows", async () => {
    await insertRoutes([route(routeId(1), TIED), route(routeId(2), TIED), route(routeId(3), TIED)]);
    const first = await listedIds("user-a");
    expect(await listedIds("user-a")).toEqual(first);
    expect(first).toEqual([routeId(3), routeId(2), routeId(1)]);
  });
});

databaseDescribe("a caller's saved-route list has no page size (ucm-M12)", () => {
  it("returns every route the caller owns, newest first, and none of another user's", async () => {
    const owned = Array.from({ length: MANY }, (_, index) =>
      route(routeId(index + 1), new Date(Date.parse(OLDEST) + index * 1_000).toISOString()));
    await insertRoutes([...owned, route(routeId(MANY + 1), NEWEST, "user-b")]);
    expect(await listedIds("user-a")).toEqual(owned.map((seeded) => seeded.id).reverse());
  });
});
