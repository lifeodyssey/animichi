import { describe, expect, it } from "vitest";
import {
  SavedRouteNotOwnedError,
  assertSavedRouteOwnedBy,
  canClaimUnownedSavedRoute,
} from "../../src/domain/route-rules";

const SAVED_ROUTE_ID = "00000000-0000-4000-8000-000000000009";

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
