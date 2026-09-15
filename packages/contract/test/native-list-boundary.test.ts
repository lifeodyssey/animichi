import { describe, expect, it } from "vitest";
import { renderInventory } from "../scripts/emit-agent-python.ts";
import openapi from "../agent-openapi.json";

describe("native conversation-index ownership", () => {
  it("publishes the edge list without claiming a Python route implements it", () => {
    expect(openapi.paths["/v1/conversations"].get["x-runtime"]).toBe("edge");
    expect(renderInventory().join("\n")).not.toContain('("GET", "/v1/conversations", ');
    expect(renderInventory().join("\n")).toContain('("GET", "/v1/conversations/{session_id}/messages", ');
  });
});
