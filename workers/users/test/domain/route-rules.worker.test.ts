import type { SavedRouteStatus } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import {
  SavedRouteNotOwnedError,
  assertSavedRouteOwnedBy,
  canClaimUnownedSavedRoute,
  isSavedRouteStatus,
  savedAtPolicy,
} from "../../src/domain/route-rules";

const SAVED_ROUTE_ID = "00000000-0000-4000-8000-000000000009";

const statusCases: { name: string; value: unknown; expected: boolean }[] = [
  { name: "draft", value: "draft", expected: true },
  { name: "saved", value: "saved", expected: true },
  { name: "completed", value: "completed", expected: true },
  { name: "unknown string", value: "bogus", expected: false },
  { name: "wrong case", value: "SAVED", expected: false },
  { name: "empty string", value: "", expected: false },
  { name: "null", value: null, expected: false },
  { name: "undefined", value: undefined, expected: false },
  { name: "number", value: 42, expected: false },
  { name: "object", value: {}, expected: false },
  { name: "array", value: ["saved"], expected: false },
];

const claimCases: { name: string; owner: string | null | undefined; expected: boolean }[] = [
  { name: "null owner", owner: null, expected: true },
  { name: "undefined owner", owner: undefined, expected: true },
  { name: "owned by a user", owner: "user-a", expected: false },
  { name: "empty owner", owner: "", expected: false },
];

const notOwnedCases: { name: string; owner: string | null | undefined }[] = [
  { name: "a different owner", owner: "user-b" },
  { name: "an unclaimed saved route", owner: null },
  { name: "a malformed row", owner: undefined },
];

const savedAtCases: {
  name: string;
  status: SavedRouteStatus;
  mode: "insert" | "update";
  expected: "null" | "now" | "coalesce";
}[] = [
  { name: "draft insert", status: "draft", mode: "insert", expected: "null" },
  { name: "draft update", status: "draft", mode: "update", expected: "null" },
  { name: "saved insert", status: "saved", mode: "insert", expected: "now" },
  { name: "saved update", status: "saved", mode: "update", expected: "coalesce" },
  { name: "completed insert", status: "completed", mode: "insert", expected: "now" },
  { name: "completed update", status: "completed", mode: "update", expected: "coalesce" },
];

function expectSavedRouteNotOwned(owner: string | null | undefined): void {
  let caught: unknown;
  try {
    assertSavedRouteOwnedBy(owner, "user-a", SAVED_ROUTE_ID);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SavedRouteNotOwnedError);
  expect(caught).toMatchObject({ savedRouteId: SAVED_ROUTE_ID });
}

describe("isSavedRouteStatus", () => {
  it.each(statusCases)("$name -> $expected", ({ value, expected }) => {
    expect(isSavedRouteStatus(value)).toBe(expected);
  });
});

describe("canClaimUnownedSavedRoute", () => {
  it.each(claimCases)("$name -> $expected", ({ owner, expected }) => {
    expect(canClaimUnownedSavedRoute(owner)).toBe(expected);
  });
});

describe("assertSavedRouteOwnedBy", () => {
  it("passes when the owner is the actor", () => {
    expect(() => { assertSavedRouteOwnedBy("user-a", "user-a", SAVED_ROUTE_ID); }).not.toThrow();
  });

  it.each(notOwnedCases)("throws SavedRouteNotOwnedError for $name", ({ owner }) => {
    expectSavedRouteNotOwned(owner);
  });
});

describe("savedAtPolicy", () => {
  it.each(savedAtCases)("$name -> $expected", ({ status, mode, expected }) => {
    expect(savedAtPolicy(status, mode)).toBe(expected);
  });
});
