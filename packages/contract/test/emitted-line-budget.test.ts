/**
 * The generated Python models have to be formatted the way `ruff format`
 * formats them (W1-5 #1254).
 *
 * Two gates read the same file and disagree if the emitter ignores the line
 * budget: `ruff format --check src/animichi/` (in `make check` and pre-push)
 * would rewrite an over-long field, and `agent-boundary.test.ts` then fails
 * because the committed file no longer equals what the emitter renders. The
 * first contract field wide enough to trip that is the run-status reason,
 * whose members ARE the `runs_failure_reason_check` vocabulary.
 *
 * The shapes below are ruff's own output, taken from running it — a `Literal`
 * alone breaks over its members, and a union with `None` is parenthesised
 * first. Anything else too long fails loudly rather than being emitted in a
 * shape a formatter would silently rewrite.
 *
 * test-type: api.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderModel } from "../scripts/emit-agent-python.js";

const REASONS = [
  "lease_expired",
  "deadline_exceeded",
  "provider_failed",
  "tool_failed",
  "cancelled",
  "internal_error",
] as const;

const WRAPPED_MEMBERS = REASONS.map((reason) => `            "${reason}",`).join("\n");
const BARE_MEMBERS = REASONS.map((reason) => `        "${reason}",`).join("\n");

function render(shape: z.ZodRawShape): string {
  return renderModel("Wide", z.object(shape)).join("\n");
}

describe("the emitted Python respects ruff's line budget", () => {
  it("wraps an optional over-long Literal in parentheses, with its default last", () => {
    expect(render({ reason: z.enum(REASONS).nullable().optional() })).toContain(
      ["    reason: (", "        Literal[", WRAPPED_MEMBERS, "        ]", "        | None", "    ) = None"].join("\n"),
    );
  });

  it("wraps a nullable over-long Literal in parentheses, with no default", () => {
    expect(render({ reason: z.enum(REASONS).nullable() })).toContain(
      ["    reason: (", "        Literal[", WRAPPED_MEMBERS, "        ]", "        | None", "    )"].join("\n"),
    );
  });

  it("breaks a required over-long Literal over its members, with no parentheses", () => {
    expect(render({ reason: z.enum(REASONS) })).toContain(
      ["    reason: Literal[", BARE_MEMBERS, "    ]"].join("\n"),
    );
  });

  it("leaves a field that fits on one line alone", () => {
    expect(render({ status: z.enum(["running", "succeeded", "failed"]) })).toContain(
      '    status: Literal["running", "succeeded", "failed"]',
    );
  });

  it("fails loudly on an over-long field it cannot wrap", () => {
    const wide = `a_field_name_long_enough_to_pass_the_budget_on_its_own_${"x".repeat(40)}`;
    expect(() => render({ [wide]: z.string() })).toThrow(/only a Literal can be wrapped/);
  });
});
