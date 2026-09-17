import { describe, expect, it } from "vitest";
import { ListConversationsResponse } from "../src/session-history-contract.js";
import openapi from "../agent-openapi.json";

describe("native conversation-index ownership", () => {
  it("publishes the edge list as edge-owned", () => {
    expect(openapi.paths["/v1/conversations"].get["x-runtime"]).toBe("edge");
  });
});

// The declared body's own ceiling. The statement behind the route hands back at
// most 30 rows, so a 31st is a defect on this side of the wire, not a page the
// sidebar should be handed — the same window the edge's `LIMIT 30` enforces.
describe("the conversation index's declared body", () => {
  it("admits the statement's 30-row window and refuses a 31st row", () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({
      session_id: `s-${index}`, title: null, first_query: null, created_at: null, updated_at: null,
    }));
    expect(ListConversationsResponse.parse(rows.slice(0, 30))).toHaveLength(30);
    expect(() => ListConversationsResponse.parse(rows)).toThrow();
  });
});
