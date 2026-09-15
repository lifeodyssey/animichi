/**
 * The Agent path inventory's exact shape (CONTRACT-1 #938, #1596).
 *
 * `AGENT_PATHS` is the one declaration the OpenAPI emitter, the Python model
 * emitter and the edge's routing and rate tables all read, so its set is pinned
 * here exactly: an added path is a deliberate, reviewable line, and a retired
 * one — #1596 retired the container's root banner — cannot silently reappear.
 * The emitter's own contract (determinism, committed-file equality, schema
 * support) lives in `agent-boundary.test.ts`.
 *
 * test-type: unit.
 */

import { describe, expect, it } from "vitest";
import { AGENT_PATHS } from "../src/agent-paths.js";

/** The inventory's exact advertised set, in declaration order. */
const RETAINED_AGENT_PATHS = [
  "GET /healthz",
  "POST /v1/chat",
  "POST /v1/byok/probe",
  "POST /v1/feedback",
  "GET /v1/conversations",
  "PATCH /v1/conversations/{session_id}",
  "GET /v1/conversations/{session_id}/messages",
  "GET /v1/conversations/{session_id}/stream",
  "POST /v1/photo-search",
  "POST /v1/photo-search/confirm",
  "POST /v1/sessions/adopt",
];

describe("the Agent path inventory", () => {
  it("covers every retained Agent path (exact set)", () => {
    expect(AGENT_PATHS.map((path) => `${path.method} ${path.path}`)).toEqual(RETAINED_AGENT_PATHS);
  });

  it("names every path once", () => {
    const paths = AGENT_PATHS.map((path) => path.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
