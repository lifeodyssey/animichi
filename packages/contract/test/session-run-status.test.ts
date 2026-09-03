/**
 * W1-5 (#1254): the run-status field on `GET /v1/conversations/{id}/messages`.
 *
 * Spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二 is why this field
 * exists at all: a client that leaves mid-turn never resumes the stream, it
 * comes back and pulls the final result once by session id — so the retrieval
 * surface has to say whether the turn it is looking at is still running, and
 * why it failed when it did. §三 calls that "多读一个状态字段", and the word
 * "多" is the binding constraint tested here: the transcript surface the web
 * parses today must keep parsing unchanged, including a payload with no `run`
 * key at all — the shape of every response captured before this field existed.
 * The Python route that serves this path until #1256 flips the flag sends the
 * key as null rather than dropping it (its generated model defaults to `None`,
 * and the route sets no `response_model_exclude_none`); both parse.
 *
 * The reason vocabulary is `runs_failure_reason_check` verbatim
 * (`migrations/neon/20260902000000_agent_runs.sql`); the edge holds the two
 * sides to each other in `workers/edge/test/agent-runs-schema.test.ts`.
 *
 * test-type: api.
 */

import { describe, expect, it } from "vitest";
import {
  GetSessionHistoryResponse,
  RunFailureReason,
  SessionRunStatus,
} from "../src/agent-contract.js";

const RUN_ID = "0199ab00-1111-7000-8000-000000000001";

/** The payload shape served before this card — no `run` key anywhere. */
function todaysHistoryPayload(): unknown {
  return {
    messages: [
      { role: "user", content: "秩父の聖地を回りたい", response_data: null, created_at: "2026-08-01T10:00:00Z" },
      {
        role: "assistant",
        content: "ルートを作成しました。",
        response_data: { intent: "search_bangumi", success: true },
        created_at: "2026-08-01T10:00:03Z",
      },
    ],
    revision: 2,
    next_offset: null,
  };
}

describe("the messages surface stays what it was", () => {
  it("parses a payload with no run field, the shape recorded before it existed", () => {
    const parsed = GetSessionHistoryResponse.parse(todaysHistoryPayload());
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.revision).toBe(2);
    expect(parsed.next_offset).toBeNull();
    expect(parsed.run).toBeUndefined();
  });

  it("keeps every message field it published before", () => {
    const parsed = GetSessionHistoryResponse.parse(todaysHistoryPayload());
    expect(parsed.messages[1]).toEqual({
      role: "assistant",
      content: "ルートを作成しました。",
      response_data: { intent: "search_bangumi", success: true },
      created_at: "2026-08-01T10:00:03Z",
    });
  });
});

describe("the run status of the session's latest run", () => {
  it("reads a session that has no run yet as an explicit null", () => {
    const parsed = GetSessionHistoryResponse.parse({ ...todaysHistoryPayload(), run: null });
    expect(parsed.run).toBeNull();
  });

  it("reads a turn still running", () => {
    const run = SessionRunStatus.parse({ run_id: RUN_ID, status: "running", reason: null });
    expect(run.status).toBe("running");
    expect(run.reason).toBeNull();
  });

  it("reads a turn that succeeded", () => {
    const run = SessionRunStatus.parse({ run_id: RUN_ID, status: "succeeded", reason: null });
    expect(run.status).toBe("succeeded");
  });

  it("reads a turn that failed, carrying why", () => {
    const parsed = GetSessionHistoryResponse.parse({
      ...todaysHistoryPayload(),
      run: { run_id: RUN_ID, status: "failed", reason: "deadline_exceeded" },
    });
    expect(parsed.run).toEqual({ run_id: RUN_ID, status: "failed", reason: "deadline_exceeded" });
  });

  it("carries the whole runs_failure_reason_check vocabulary and nothing else", () => {
    expect(RunFailureReason.options).toEqual([
      "lease_expired",
      "deadline_exceeded",
      "provider_failed",
      "tool_failed",
      "cancelled",
      "internal_error",
    ]);
  });

  it("refuses a failure reason outside that vocabulary", () => {
    const outside = { run_id: RUN_ID, status: "failed", reason: "database exploded" };
    expect(() => SessionRunStatus.parse(outside)).toThrow();
  });

  it("refuses a status outside running / succeeded / failed", () => {
    expect(() => SessionRunStatus.parse({ run_id: RUN_ID, status: "queued" })).toThrow();
  });
});
