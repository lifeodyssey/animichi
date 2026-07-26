import { describe, expect, it } from "vitest";
import { routeDocumentKey, supersededFlags } from "../../../src/lib/chat/supersession";
import { parsedPart, routePartRaw, ujiPoints } from "./_route-fixtures";

describe("supersededFlags (E1 rule, shared with issue #273)", () => {
  it("dims every earlier card of a key, keeping only the newest current", () => {
    expect(supersededFlags(["route", undefined, "route", "route"])).toEqual([true, false, true, false]);
  });

  it("tracks keys independently so different documents never dim each other", () => {
    expect(supersededFlags(["route", "shiori", "route"])).toEqual([true, false, false]);
  });

  it("never dims keyless entries", () => {
    expect(supersededFlags([undefined, undefined])).toEqual([false, false]);
  });
});

describe("routeDocumentKey (route cards as the first living document)", () => {
  it("keys every route-family intent that carries a route", () => {
    const intents = ["plan_route", "plan_selected", "plan_multi", "partial"];
    const keys = intents.map((intent) => routeDocumentKey({ ...routePartRaw(ujiPoints().slice()), intent }));
    expect(keys).toEqual(["route", "route", "route", "route"]);
  });

  it("accepts the exact shape the contract schema emits", () => {
    expect(routeDocumentKey(parsedPart(routePartRaw(ujiPoints().slice())))).toBe("route");
  });

  it("leaves intent-only frames keyless so a streaming skeleton never dims the old card", () => {
    expect(routeDocumentKey({ intent: "plan_route" })).toBeUndefined();
  });

  it("leaves non-route intents and malformed payloads keyless", () => {
    expect(routeDocumentKey({ intent: "search_bangumi", data: { results: {} } })).toBeUndefined();
    expect(routeDocumentKey({ intent: "plan_route", data: { route: null } })).toBeUndefined();
    expect(routeDocumentKey({ intent: "plan_route", data: { route: undefined } })).toBeUndefined();
    expect(routeDocumentKey({ intent: 42, data: {} })).toBeUndefined();
    expect(routeDocumentKey("not-an-object")).toBeUndefined();
  });
});
