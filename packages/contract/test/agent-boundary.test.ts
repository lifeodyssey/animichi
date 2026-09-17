/**
 * Agent boundary contract tests (CONTRACT-1 #938).
 *
 * The wire shapes the Agent HTTP surface accepts and returns parse the payloads
 * their callers send: the BYOK probe's error envelope, a history page with a
 * null next offset, and a structured clarify-candidate pick with no free text.
 */

import { describe, expect, it } from "vitest";
import { ByokProbeErrorBody, ChatTurnRequest } from "../src/agent-contract.js";
import { GetSessionHistoryResponse } from "../src/session-history-contract.js";

describe("agent boundary shapes", () => {
  it("ByokProbeErrorBody models the agent error envelope shape", () => {
    const shape = ByokProbeErrorBody.safeParse({ error: { code: "egress_blocked" } });
    expect(shape.success).toBe(true);
    const full = ByokProbeErrorBody.safeParse({
      error: { code: "egress_blocked", message: "base_url failed egress validation." },
    });
    expect(full.success).toBe(true);
  });

  it("the history payload parses a typed page with a null next offset", () => {
    const page = GetSessionHistoryResponse.safeParse({
      messages: [{ role: "user", content: "hi", response_data: null, created_at: "2026-08-01T00:00:00Z" }],
      revision: 0,
      next_offset: null,
    });
    expect(page.success).toBe(true);
  });

  it("a structured candidate pick parses without free text (W1 #1220)", () => {
    const pick = ChatTurnRequest.parse({
      text: "",
      selected_candidate_ids: ["115908", "117696"],
      clarification_id: 4,
    });
    expect(pick.selected_point_ids).toBeUndefined();
  });
});
