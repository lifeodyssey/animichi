import { describe, expect, it } from "vitest";
import {
  deriveEntryState,
  resolveRouteReference,
} from "../../../src/features/chat/entry-state";

const healthy = { healthy: true } as const;

describe("deriveEntryState", () => {
  it("returns A1 on a healthy cold start with no entry signals", () => {
    expect(deriveEntryState({ ...healthy })).toBe("A1");
  });

  it("returns A2 when a query is present", () => {
    expect(deriveEntryState({ ...healthy, query: "ユーフォ" })).toBe("A2");
  });

  it("returns A2b when a route reference resolved", () => {
    const state = deriveEntryState({
      ...healthy,
      routeReference: { title: "宇治ルート" },
    });
    expect(state).toBe("A2b");
  });

  it("degrades a missing route reference to A1, not a broken card", () => {
    expect(deriveEntryState({ ...healthy, routeReference: "missing" })).toBe("A1");
  });

  it("returns A3 when a session id is present", () => {
    expect(deriveEntryState({ ...healthy, sessionId: "s-1" })).toBe("A3");
  });

  it("returns A5 whenever the backend is unreachable", () => {
    const state = deriveEntryState({
      healthy: false,
      query: "q",
      sessionId: "s-1",
    });
    expect(state).toBe("A5");
  });
});

describe("resolveRouteReference", () => {
  it("returns undefined without a route param", () => {
    expect(resolveRouteReference(undefined)).toBeUndefined();
  });

  it("reports missing for an unresolvable route id", () => {
    expect(resolveRouteReference("r-deleted")).toBe("missing");
  });
});
