/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ToolStepBadge,
  stepStatus,
} from "../../../src/features/chat/components/ToolStepBadge";

describe("stepStatus", () => {
  it("maps output-available to done", () => {
    expect(stepStatus("output-available")).toBe("done");
  });

  it("maps output-error to error", () => {
    expect(stepStatus("output-error")).toBe("error");
  });

  it("maps in-flight states to running", () => {
    expect(stepStatus("input-streaming")).toBe("running");
    expect(stepStatus("input-available")).toBe("running");
  });
});

describe("ToolStepBadge", () => {
  it("shows the bare tool name with its status", () => {
    render(<ToolStepBadge type="tool-resolve_anime" state="output-available" />);
    const badge = screen.getByText("resolve_anime");
    expect(badge.getAttribute("data-status")).toBe("done");
  });

  it("marks running steps", () => {
    render(<ToolStepBadge type="tool-plan_route" state="input-streaming" />);
    expect(screen.getByText("plan_route").getAttribute("data-status")).toBe("running");
  });
});
