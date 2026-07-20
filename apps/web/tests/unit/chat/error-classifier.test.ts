import type { ChatDataPart } from "@seichijunrei/contract";
import { describe, expect, it } from "vitest";
import { classifyFailure } from "../../../src/lib/chat/errorClassifier";

type SearchIntent = "search_bangumi" | "search_nearby";

function searchPart(intent: SearchIntent, results?: Record<string, unknown>): ChatDataPart {
  const data = results === undefined ? undefined : { results };
  return { intent, success: true, data };
}

function routePart(route?: Record<string, unknown>): ChatDataPart {
  const data = route === undefined ? undefined : { route };
  return { intent: "plan_route", success: true, data };
}

function failedPart(intent: "error" | "unknown", code?: string): ChatDataPart {
  const errors = code === undefined ? [] : [{ code, message: "internal detail" }];
  if (intent === "error") return { intent: "error", success: false, errors };
  return { intent: "unknown", success: false, errors };
}

function prosePart(intent: "clarify" | "greet_user"): ChatDataPart {
  if (intent === "clarify") return { intent: "clarify", success: true };
  return { intent: "greet_user", success: true };
}

describe("classifyFailure: transport signals", () => {
  it.each([
    [401, "D8"],
    [403, "D8"],
    [408, "D5"],
    [504, "D5"],
    [500, "D4"],
    [502, "D4"],
  ] as const)("maps HTTP %d onto %s", (status, expected) => {
    expect(classifyFailure({ kind: "http", status })).toBe(expected);
  });

  it("maps a mid-stream abort onto the D4 interruption state", () => {
    expect(classifyFailure({ kind: "stream-abort" })).toBe("D4");
  });

  it("maps the 60s turn watchdog onto the D5 timeout state", () => {
    expect(classifyFailure({ kind: "timeout" })).toBe("D5");
  });
});

describe("classifyFailure: image signals", () => {
  it.each([
    ["map", "D7"],
    ["scene", "D9"],
  ] as const)("maps a failed %s image onto %s", (surface, expected) => {
    expect(classifyFailure({ kind: "image", surface })).toBe(expected);
  });
});

describe("classifyFailure: failed envelopes", () => {
  it.each([
    ["error", "anime_not_found", "D1"],
    ["unknown", "no_bangumi_found", "D1"],
    ["error", "invalid_station", "D1"],
    ["error", "agent_timeout", "D5"],
    ["error", "pipeline_error", "D6"],
    ["error", "output_validation_failed", "D6"],
    ["unknown", undefined, "D6"],
  ] as const)("maps a failed %s envelope with code %s onto %s", (intent, code, expected) => {
    const part = failedPart(intent, code);
    expect(classifyFailure({ kind: "envelope", part })).toBe(expected);
  });

  it("treats success=false on a non-error intent as a D6 rejection", () => {
    const part = { intent: "plan_route", success: false, errors: [] } as ChatDataPart;
    expect(classifyFailure({ kind: "envelope", part })).toBe("D6");
  });
});

describe("classifyFailure: empty and short result envelopes", () => {
  it.each([
    ["search_bangumi", { rows: [] }, "D2"],
    ["search_bangumi", { row_count: 0 }, "D2"],
    ["search_nearby", { rows: [] }, "D2"],
  ] as const)("maps %s with %o onto %s", (intent, results, expected) => {
    const part = searchPart(intent, results);
    expect(classifyFailure({ kind: "envelope", part })).toBe(expected);
  });

  it("maps a route that collapsed to zero points onto D2", () => {
    const part = routePart({ point_count: 0 });
    expect(classifyFailure({ kind: "envelope", part })).toBe("D2");
  });

  it.each([
    [{ point_count: 2 }],
    [{ ordered_points: [{ id: "p1", name: "宇治橋" }] }],
  ])("maps a short route %o onto D3", (route) => {
    expect(classifyFailure({ kind: "envelope", part: routePart(route) })).toBe("D3");
  });
});

describe("classifyFailure: healthy envelopes stay unclassified", () => {
  it.each([
    ["search with rows", searchPart("search_bangumi", { rows: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] })],
    ["search without result evidence", searchPart("search_bangumi")],
    ["route with three points", routePart({ point_count: 3 })],
    ["route without point evidence", routePart()],
    ["clarify", prosePart("clarify")],
    ["greeting", prosePart("greet_user")],
  ])("leaves a healthy %s envelope alone", (_label, part) => {
    expect(classifyFailure({ kind: "envelope", part })).toBeUndefined();
  });
});
