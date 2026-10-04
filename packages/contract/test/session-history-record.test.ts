/**
 * Ticket 4 of #1996 (#2004): the complete per-turn record fields on
 * `GET /v1/conversations/{id}/messages`.
 *
 * What is tested here is the property the decision hangs on: the new fields are
 * ADDITIVE. Every payload the browser parses today — the one with no
 * `tool_results`/`model_calls` keys at all, and the one the Python route sends
 * with the keys null because its generated model defaults to `None` — must keep
 * parsing unchanged, or a client on the old shape breaks the moment the edge
 * publishes the new one.
 *
 * test-type: api.
 */

import { describe, expect, it } from "vitest";
import { GetSessionHistoryResponse, SessionModelCall, SessionToolResult, SessionUsage } from "../src/session-history-contract.js";

const RUN_ID = "0199ab00-1111-7000-8000-000000000001";

/** The payload shape served before this card — no record keys anywhere. */
function historyPayloadWithoutRecord(): unknown {
  return {
    messages: [
      { role: "user", content: "秩父の聖地を回りたい", response_data: null, created_at: "2026-08-01T10:00:00Z" },
    ],
    revision: 1,
    next_offset: null,
    run: { run_id: RUN_ID, status: "succeeded", reason: null },
  };
}

/** One model call as the edge projects a persisted usage row. */
function modelCall(overrides: Record<string, unknown> = {}): unknown {
  return {
    provider: "xiaomi",
    model: "mimo-v2.6-flash",
    usage: { input: 30, output: 20, cache_read: 0, cache_write: 0, total_tokens: 50,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 } },
    ...overrides,
  };
}

/** One tool result as the edge projects a committed tool result entry. */
function toolResult(overrides: Record<string, unknown> = {}): unknown {
  return { tool_call_id: "call-1", tool_name: "search_bangumi", is_error: false, result: '{"rows":[]}', ...overrides };
}

describe("the messages surface stays what it was", () => {
  it("parses a payload with no record fields, the shape recorded before they existed", () => {
    const parsed = GetSessionHistoryResponse.parse(historyPayloadWithoutRecord());
    expect(parsed.tool_results).toBeUndefined();
    expect(parsed.model_calls).toBeUndefined();
  });

  it("parses the explicit null the Python route sends for the same page", () => {
    const parsed = GetSessionHistoryResponse.parse({ ...historyPayloadWithoutRecord(), tool_results: null, model_calls: null });
    expect(parsed.tool_results).toBeNull();
    expect(parsed.model_calls).toBeNull();
  });
});

describe("one model call", () => {
  it("carries the provider, the model and the per-call usage", () => {
    expect(SessionModelCall.parse(modelCall())).toEqual(modelCall());
  });

  it("refuses a usage that is not the recorded counters", () => {
    expect(() => SessionUsage.parse({ input: 1 })).toThrow();
  });
});

describe("one tool result", () => {
  it("carries the call, the tool, the error flag and the JSON-text result", () => {
    expect(SessionToolResult.parse(toolResult())).toEqual(toolResult());
  });

  it("refuses a result that is not the JSON text the auditor parses", () => {
    expect(() => SessionToolResult.parse(toolResult({ result: { rows: [] } }))).toThrow();
  });
});
