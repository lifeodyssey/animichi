import { describe, expect, it } from "vitest";
import type { UserRoute } from "@seichijunrei/contract";
import { pickContinueFrom } from "../../../src/api/hooks/use-continue-from";

function makeRoute(overrides: Partial<UserRoute>): UserRoute {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Draft route",
    point_ids: ["p1"],
    status: "draft",
    saved_at: null,
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickContinueFrom", () => {
  it("selects the most recently updated in-progress (draft) route", () => {
    const older = makeRoute({ id: "00000000-0000-0000-0000-00000000000a", updated_at: "2026-07-01T00:00:00.000Z" });
    const newer = makeRoute({ id: "00000000-0000-0000-0000-00000000000b", updated_at: "2026-07-10T00:00:00.000Z" });
    expect(pickContinueFrom([older, newer])?.id).toBe(newer.id);
  });

  it("ignores saved and completed routes (SD-8: in-progress only)", () => {
    const saved = makeRoute({ status: "saved" });
    const completed = makeRoute({ status: "completed" });
    expect(pickContinueFrom([saved, completed])).toBeUndefined();
  });

  it("returns undefined for an empty route list", () => {
    expect(pickContinueFrom([])).toBeUndefined();
  });
});
