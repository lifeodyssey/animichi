import { describe, expect, it } from "vitest";
import {
  SavedRouteNotOwnedError,
  assertSavedRouteOwnedBy,
} from "../../src/domain/route-rules";

const SAVED_ROUTE_ID = "00000000-0000-4000-8000-000000000009";

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

describe("assertSavedRouteOwnedBy", () => {
  it("passes when the owner is the actor", () => {
    expect(() => { assertSavedRouteOwnedBy("user-a", "user-a", SAVED_ROUTE_ID); }).not.toThrow();
  });

  it.each(notOwnedCases)("throws SavedRouteNotOwnedError for $name", ({ owner }) => {
    expectSavedRouteNotOwned(owner);
  });
});
