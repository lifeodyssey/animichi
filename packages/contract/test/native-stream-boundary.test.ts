import { describe, expect, it } from "vitest";
import { SessionHistoryMessage } from "../src/session-history-contract.ts";
import openapi from "../agent-openapi.json";

describe("native stream ownership", () => {
  it("publishes the edge stream as edge-owned", () => {
    expect(openapi.paths["/v1/conversations/{session_id}/stream"].get["x-runtime"]).toBe("edge");
  });

  it("retains native operation identity independently of text and creation time", () => {
    const message = { role: "assistant", content: "Same answer", created_at: "1970-01-01T00:00:00.000Z", operation_id: "native-operation" };
    expect(SessionHistoryMessage.parse(message)).toEqual(message);
  });
});
