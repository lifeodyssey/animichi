/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ToolStepBadge,
  stepStatus,
} from "../../../src/features/chat/components/ToolStepBadge";
import { TOOL_STEP_KEYS, chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

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

describe("ToolStepBadge localized copy", () => {
  it.each(LOCALES)("renders the %s label for every mapped tool, never the raw id", (locale) => {
    const dict = chatDictFor(locale);
    for (const key of TOOL_STEP_KEYS) {
      const { unmount } = render(
        <ToolStepBadge type={`tool-${key}`} state="output-available" dict={dict} />,
      );
      const badge = screen.getByText(dict.toolSteps.labels[key]);
      expect(badge.textContent).not.toBe(key);
      unmount();
    }
  });

  it("keeps the raw identifier in data-tool while showing localized text", () => {
    const dict = chatDictFor("ja");
    render(<ToolStepBadge type="tool-search_bangumi" state="output-available" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.labels.search_bangumi);
    expect(badge.getAttribute("data-tool")).toBe("search_bangumi");
    expect(badge.getAttribute("data-status")).toBe("done");
  });

  it("marks running steps", () => {
    const dict = chatDictFor("ja");
    render(<ToolStepBadge type="tool-plan_route" state="input-streaming" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.labels.plan_route);
    expect(badge.getAttribute("data-status")).toBe("running");
  });
});

describe("ToolStepBadge unknown-tool degradation", () => {
  it.each(LOCALES)("renders the %s fallback label for an unmapped tool", (locale) => {
    const dict = chatDictFor(locale);
    render(<ToolStepBadge type="tool-brand_new_tool" state="input-available" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.fallback);
    expect(badge.textContent).not.toBe("brand_new_tool");
    expect(badge.textContent.length).toBeGreaterThan(0);
  });

  it("keeps the raw identifier in data-tool for unmapped tools", () => {
    const dict = chatDictFor("en");
    const { container } = render(
      <ToolStepBadge type="tool-brand_new_tool" state="input-available" dict={dict} />,
    );
    const badge = container.querySelector(".chat-step");
    expect(badge?.getAttribute("data-tool")).toBe("brand_new_tool");
    expect(badge?.textContent).toBe(dict.toolSteps.fallback);
  });
});

describe("ToolStepBadge hidden tools", () => {
  it("suppresses translate_anime_title from the badge stream", () => {
    const dict = chatDictFor("ja");
    const { container } = render(
      <ToolStepBadge type="tool-translate_anime_title" state="output-available" dict={dict} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
