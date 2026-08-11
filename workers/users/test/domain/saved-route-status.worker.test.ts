import type { SavedRouteStatus } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { isSavedRouteStatus, savedAtForStatus } from "../../src/domain/saved-route-status";

const NOW = "2026-07-13T04:00:00.000Z";
const PREVIOUS = "2026-07-12T00:00:00.000Z";

const statusCases: { name: string; value: unknown; expected: boolean }[] = [
  { name: "draft", value: "draft", expected: true },
  { name: "saved", value: "saved", expected: true },
  { name: "completed", value: "completed", expected: true },
  { name: "unknown string", value: "bogus", expected: false },
  { name: "wrong case", value: "SAVED", expected: false },
  { name: "null", value: null, expected: false },
  { name: "number", value: 42, expected: false },
];

const savedAtCases: { name: string; status: SavedRouteStatus; previous: string | null; expected: string | null }[] = [
  { name: "a new draft is not stamped", status: "draft", previous: null, expected: null },
  { name: "a draft clears a previous stamp", status: "draft", previous: PREVIOUS, expected: null },
  { name: "a new saved route is stamped now", status: "saved", previous: null, expected: NOW },
  { name: "a new completed route is stamped now", status: "completed", previous: null, expected: NOW },
  { name: "an update keeps the previous stamp", status: "saved", previous: PREVIOUS, expected: PREVIOUS },
  { name: "an update stamps only when none exists", status: "completed", previous: null, expected: NOW },
];

describe("isSavedRouteStatus", () => {
  it.each(statusCases)("$name -> $expected", ({ value, expected }) => {
    expect(isSavedRouteStatus(value)).toBe(expected);
  });
});

describe("savedAtForStatus", () => {
  it.each(savedAtCases)("$name", ({ status, previous, expected }) => {
    expect(savedAtForStatus(status, previous, NOW)).toBe(expected);
  });
});
