import { describe, expect, it } from "vitest";
import { statusedSteps, stepStatus } from "../../../src/features/chat/tool-steps";

function step(type: string, state: string, toolCallId: string, input?: unknown) {
  return { type, state, toolCallId, input };
}

describe("stepStatus", () => {
  it("maps output-available to done", () => {
    expect(stepStatus("output-available")).toBe("done");
  });

  it("maps output-error to error", () => {
    expect(stepStatus("output-error")).toBe("error");
  });

  it("maps output-denied to error", () => {
    expect(stepStatus("output-denied")).toBe("error");
  });

  it("maps in-flight states to running", () => {
    expect(stepStatus("input-streaming")).toBe("running");
    expect(stepStatus("input-available")).toBe("running");
  });
});

describe("statusedSteps supersession (ModelRetry re-issues the same tool under a fresh call id)", () => {
  it("demotes an errored step to retried once the same tool is called again", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1"),
      step("tool-search_bangumi", "output-available", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "done"]);
  });

  it("demotes an errored step while its retry is still running", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1"),
      step("tool-search_bangumi", "input-available", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "running"]);
  });

  it("keeps a terminal error as error when the tool is never retried", () => {
    const steps = [
      step("tool-resolve_anime", "output-available", "call-1"),
      step("tool-search_bangumi", "output-error", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["done", "error"]);
  });

  it("keeps the last failure as error when every retry of that tool also failed", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1"),
      step("tool-search_bangumi", "output-error", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "error"]);
  });

  it("never demotes a denied step, even when the same tool is called again", () => {
    const steps = [
      step("tool-search_bangumi", "output-denied", "call-1"),
      step("tool-search_bangumi", "output-available", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["error", "done"]);
  });

  it("never demotes an error superseded only by a different tool", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1"),
      step("tool-plan_route", "output-available", "call-2"),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["error", "done"]);
  });

  it("preserves the original step alongside its status", () => {
    const steps = [step("tool-plan_route", "output-available", "call-9")];

    expect(statusedSteps(steps)[0]?.step.toolCallId).toBe("call-9");
  });

  it("matches retry inputs regardless of object key order", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1", { query: "eupho", limit: 5 }),
      step("tool-search_bangumi", "output-available", "call-2", { limit: 5, query: "eupho" }),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "done"]);
  });

  it("compares non-serialisable primitive inputs without throwing", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1", 1n),
      step("tool-search_bangumi", "output-available", "call-2", 1n),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "done"]);
  });

  it("compares array inputs structurally", () => {
    const steps = [
      step("tool-search_bangumi", "output-error", "call-1", [{ query: "eupho" }]),
      step("tool-search_bangumi", "output-available", "call-2", [{ query: "eupho" }]),
    ];

    expect(statusedSteps(steps).map((entry) => entry.status)).toEqual(["retried", "done"]);
  });
});
