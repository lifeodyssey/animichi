import { describe, expect, it } from "vitest";
import { decideOwnership } from "../../src/domain/ownership";
import type { OwnerLookup, OwnershipDecision } from "../../src/domain/ownership";

const LOOKUP: OwnerLookup = { userId: "user-a", savedAt: "2026-07-13T04:00:00.000Z" };

const cases: { name: string; owner: OwnerLookup | undefined; actor: string; expected: OwnershipDecision }[] = [
  { name: "the owner may save their route", owner: LOOKUP, actor: "user-a", expected: { kind: "ok", owner: LOOKUP } },
  { name: "a different user is not the owner", owner: LOOKUP, actor: "user-b", expected: { kind: "not_owned" } },
  { name: "an unclaimed route (null owner) has no owner", owner: { ...LOOKUP, userId: null }, actor: "user-a", expected: { kind: "not_owned" } },
  { name: "a missing route is not found", owner: undefined, actor: "user-a", expected: { kind: "not_found" } },
];

describe("decideOwnership", () => {
  it.each(cases)("$name", ({ owner, actor, expected }) => {
    expect(decideOwnership(owner, actor)).toEqual(expected);
  });
});
