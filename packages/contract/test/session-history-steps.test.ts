/**
 * E-2 (#1381): the settled tool params on `GET /v1/conversations/{id}/messages`.
 *
 * The field exists so `argument_correctness` has a second witness to score
 * against: the SD-9 stream publishes the model's own account of a call and the
 * retrieval publishes what the tool executed with, and only the pair can say
 * whether the call was made with the arguments the model asked for.
 *
 * What is tested here is the one property that decision hangs on being safe:
 * the field is ADDITIVE. Every payload the browser parses today — the one with
 * no `steps` key at all, and the one the Python route sends with the key null
 * because its generated model defaults to `None` — must keep parsing
 * unchanged, or a client on the old shape breaks the moment the edge publishes
 * the new one.
 *
 * test-type: api.
 */

import { describe, expect, it } from "vitest";
import { GetSessionHistoryResponse, SessionHistoryStep } from "../src/session-history-contract.js";

const RUN_ID = "0199ab00-1111-7000-8000-000000000001";

/** The payload shape served before this card — no `steps` key anywhere. */
function historyPayloadWithoutSteps(): unknown {
  return {
    messages: [
      { role: "user", content: "秩父の聖地を回りたい", response_data: null, created_at: "2026-08-01T10:00:00Z" },
    ],
    revision: 1,
    next_offset: null,
    run: { run_id: RUN_ID, status: "succeeded", reason: null },
  };
}

/** One published step, as the edge projects a settled `run_steps` row. */
function publishedStep(overrides: Record<string, unknown> = {}): unknown {
  return {
    run_id: RUN_ID,
    step_index: 0,
    tool_name: "search_bangumi",
    params: '{"bangumi_id":12345}',
    ...overrides,
  };
}

describe("the messages surface stays what it was", () => {
  it("parses a payload with no steps field, the shape recorded before it existed", () => {
    const parsed = GetSessionHistoryResponse.parse(historyPayloadWithoutSteps());
    expect(parsed.steps).toBeUndefined();
    expect(parsed.messages).toHaveLength(1);
  });

  it("parses the explicit null the Python route sends for the same page", () => {
    const parsed = GetSessionHistoryResponse.parse({ ...historyPayloadWithoutSteps(), steps: null });
    expect(parsed.steps).toBeNull();
  });
});

describe("one settled step of one run", () => {
  it("carries the run that numbered it, its index, its tool and its params", () => {
    expect(SessionHistoryStep.parse(publishedStep())).toEqual({
      run_id: RUN_ID,
      step_index: 0,
      tool_name: "search_bangumi",
      params: '{"bangumi_id":12345}',
    });
  });

  it("keeps every run's steps on the page, each under its own run", () => {
    const other = "0199ab00-1111-7000-8000-000000000002";
    const steps = [publishedStep(), publishedStep({ run_id: other, step_index: 1 })];
    const parsed = GetSessionHistoryResponse.parse({ ...historyPayloadWithoutSteps(), steps });
    expect(parsed.steps?.map((step) => [step.run_id, step.step_index])).toEqual([
      [RUN_ID, 0],
      [other, 1],
    ]);
  });

  it("refuses a step index that is not a whole non-negative number", () => {
    expect(() => SessionHistoryStep.parse(publishedStep({ step_index: -1 }))).toThrow();
  });

  it("refuses params that are not the JSON text the evaluator parses", () => {
    expect(() => SessionHistoryStep.parse(publishedStep({ params: { bangumi_id: 12345 } }))).toThrow();
  });
});
