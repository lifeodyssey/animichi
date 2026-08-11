import type { SavedRoute } from "@animichi/contract";
import { describe, expect, it, vi } from "vitest";
import { listSavedRoutes } from "../src/application/list-saved-routes";
import type { ListSavedRoutesObservation, SavedRouteReader } from "../src/application/list-saved-routes";

const ID = "00000000-0000-4000-8000-000000000009";

function route(id: string, updatedAt: string): SavedRoute {
  return {
    id, title: "Tokyo", point_ids: ["p1"], status: "saved",
    saved_at: null, updated_at: updatedAt,
  };
}

function stubReader(owned: SavedRoute[]): SavedRouteReader {
  return { listOwned: vi.fn().mockResolvedValue(owned) };
}

describe("ListSavedRoutes application action", () => {
  it("returns the owned routes newest update first", async () => {
    const older = route("00000000-0000-4000-8000-000000000001", "2026-07-12T00:00:00Z");
    const newer = route("00000000-0000-4000-8000-000000000002", "2026-07-13T00:00:00Z");
    const reader = stubReader([older, newer]);
    const result = await listSavedRoutes(reader, "user-a");
    expect(result.saved_routes.map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("reads only the caller's owned routes through the reader", async () => {
    const reader = stubReader([route(ID, "2026-07-13T00:00:00Z")]);
    await listSavedRoutes(reader, "user-a");
    expect(reader.listOwned).toHaveBeenCalledExactlyOnceWith("user-a");
  });

  it("returns an empty list for a store with no owned routes", async () => {
    expect(await listSavedRoutes(stubReader([]), "user-a")).toEqual({ saved_routes: [] });
  });

  it("does not mutate the reader's row order in place", async () => {
    const older = route("00000000-0000-4000-8000-000000000001", "2026-07-12T00:00:00Z");
    const newer = route("00000000-0000-4000-8000-000000000002", "2026-07-13T00:00:00Z");
    const owned = [older, newer];
    const reader = stubReader(owned);
    await listSavedRoutes(reader, "user-a");
    expect(reader.listOwned).toHaveBeenCalledOnce();
    expect(owned).toEqual([older, newer]);
  });

  it("records a redacted loaded observation with the injected clock's duration", async () => {
    const observations: ListSavedRoutesObservation[] = [];
    await listSavedRoutes(stubReader([route(ID, "2026-07-13T00:00:00Z")]), "user-a", {
      observer: { record: (o) => observations.push(o) },
      clock: { now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1025) },
    });
    expect(observations).toEqual([{ outcome: "loaded", count: 1, duration_ms: 25 }]);
  });

  it("records an empty observation when the store has no owned routes", async () => {
    const observations: ListSavedRoutesObservation[] = [];
    await listSavedRoutes(stubReader([]), "user-a", {
      observer: { record: (o) => observations.push(o) },
      clock: { now: () => 7 },
    });
    expect(observations).toEqual([{ outcome: "empty", count: 0, duration_ms: 0 }]);
  });
});
