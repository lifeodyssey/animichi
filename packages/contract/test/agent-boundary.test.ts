/**
 * Agent boundary contract tests (CONTRACT-1 #938).
 *
 * Red/green contract for the deterministic Python emitter:
 *  - two generations are byte-identical (determinism);
 *  - emitted output equals the committed generated file (clean-tree);
 *  - deleting a health field or retained path fails;
 *  - a deliberately unsupported schema construct fails loudly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AGENT_PATHS, ServiceMetadata } from "../src/agent-contract.js";
import { renderContent, renderModel } from "../scripts/emit-agent-python.js";

const COMMITTED = readFileSync(
  join(__dirname, "..", "..", "..", "apps", "agent", "src", "animichi", "interfaces", "boundary", "agent_models.py"),
  "utf8",
);

describe("agent boundary emitter", () => {
  it("two generations are byte-identical", () => {
    const first = renderModel("ServiceMetadata", ServiceMetadata).join("\n");
    const second = renderModel("ServiceMetadata", ServiceMetadata).join("\n");
    expect(second).toBe(first);
  });

  it("emitted output matches the committed generated file (clean-tree)", () => {
    expect(renderContent()).toBe(COMMITTED);
  });

  it("generated ServiceMetadata retains every health field (deleting one fails)", () => {
    const rendered = renderModel("ServiceMetadata", ServiceMetadata).join("\n");
    for (const field of [
      "status",
      "service",
      "git_commit",
      "git_branch",
      "started_at",
      "app_env",
      "observability_enabled",
      "db_adapter",
      "session_store",
    ]) {
      expect(rendered).toContain(`    ${field}:`);
    }
  });

  it("omitting a health field from the schema drops it from the rendered model", () => {
    const withoutCommit = z.object({
      status: z.literal("ok"),
      service: z.string(),
      git_branch: z.string(),
    });
    const rendered = renderModel("ServiceMetadata", withoutCommit).join("\n");
    expect(rendered).not.toContain("git_commit");
    expect(rendered).toContain("git_branch");
  });

  it("an unsupported schema construct fails loudly", () => {
    expect(() => renderModel("BadModel", z.object({ count: z.number() }))).toThrow(/unsupported schema construct/);
    // z.date() cannot even reach the emitter — zod's own JSON-schema
    // conversion rejects it; either failure mode is a loud failure.
    expect(() => renderModel("BadModel", z.object({ at: z.date() }))).toThrow();
  });

  it("the path inventory covers every retained Agent path (exact set)", () => {
    expect(AGENT_PATHS.map((p) => `${p.method} ${p.path}`)).toEqual([
      "GET /",
      "GET /healthz",
      "POST /v1/runtime",
      "POST /v1/runtime/stream",
      "POST /v1/chat",
      "POST /v1/byok/probe",
      "POST /v1/feedback",
      "GET /v1/conversations",
      "PATCH /v1/conversations/{session_id}",
      "GET /v1/conversations/{session_id}/messages",
      "GET /v1/bangumi/popular",
      "GET /v1/bangumi/{bangumi_id}/guide",
      "GET /v1/bangumi/nearby",
      "GET /v1/search/preview",
      "POST /v1/photo-search",
      "POST /v1/photo-search/confirm",
      "POST /v1/session/migrate",
    ]);
    expect(new Set(AGENT_PATHS.map((p) => p.path)).size).toBe(AGENT_PATHS.length);
  });
});
