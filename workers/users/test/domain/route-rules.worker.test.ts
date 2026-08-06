import type { RouteStatus } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import {
  RouteNotOwnedError,
  assertRouteOwnedBy,
  canClaimUnowned,
  isRouteStatus,
  savedAtPolicy,
} from "../../src/domain/route-rules";

const ROUTE_ID = "00000000-0000-4000-8000-000000000009";

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
  { name: "an unclaimed route", owner: null },
  { name: "a malformed row", owner: undefined },
];

const savedAtCases: {
  name: string;
  status: RouteStatus;
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

function expectRouteNotOwned(owner: string | null | undefined): void {
  let caught: unknown;
  try {
    assertRouteOwnedBy(owner, "user-a", ROUTE_ID);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RouteNotOwnedError);
  expect(caught).toMatchObject({ routeId: ROUTE_ID });
}

describe("isRouteStatus", () => {
  it.each(statusCases)("$name -> $expected", ({ value, expected }) => {
    expect(isRouteStatus(value)).toBe(expected);
  });
});

describe("canClaimUnowned", () => {
  it.each(claimCases)("$name -> $expected", ({ owner, expected }) => {
    expect(canClaimUnowned(owner)).toBe(expected);
  });
});

describe("assertRouteOwnedBy", () => {
  it("passes when the owner is the actor", () => {
    expect(() => { assertRouteOwnedBy("user-a", "user-a", ROUTE_ID); }).not.toThrow();
  });

  it.each(notOwnedCases)("throws RouteNotOwnedError for $name", ({ owner }) => {
    expectRouteNotOwned(owner);
  });
});

describe("savedAtPolicy", () => {
  it.each(savedAtCases)("$name -> $expected", ({ status, mode, expected }) => {
    expect(savedAtPolicy(status, mode)).toBe(expected);
  });
});
