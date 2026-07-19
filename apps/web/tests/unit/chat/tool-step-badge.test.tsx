/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolStepBadge } from "../../../src/features/chat/components/ToolStepBadge";
import { TOOL_STEP_KEYS, chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

afterEach(cleanup);

describe("ToolStepBadge localized copy", () => {
  it.each(LOCALES)("renders the %s label for every mapped tool, never the raw id", (locale) => {
    const dict = chatDictFor(locale);
    for (const key of TOOL_STEP_KEYS) {
      const { unmount } = render(
        <ToolStepBadge type={`tool-${key}`} status="done" dict={dict} />,
      );
      const badge = screen.getByText(dict.toolSteps.labels[key]);
      expect(badge.textContent).not.toBe(key);
      unmount();
    }
  });

  it("keeps the raw identifier in data-tool while showing localized text", () => {
    const dict = chatDictFor("ja");
    render(<ToolStepBadge type="tool-search_bangumi" status="done" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.labels.search_bangumi);
    expect(badge.getAttribute("data-tool")).toBe("search_bangumi");
    expect(badge.getAttribute("data-status")).toBe("done");
  });

  it("marks running steps", () => {
    const dict = chatDictFor("ja");
    render(<ToolStepBadge type="tool-plan_route" status="running" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.labels.plan_route);
    expect(badge.getAttribute("data-status")).toBe("running");
  });
});

describe("ToolStepBadge unknown-tool degradation", () => {
  it.each(LOCALES)("renders the %s fallback label for an unmapped tool", (locale) => {
    const dict = chatDictFor(locale);
    render(<ToolStepBadge type="tool-brand_new_tool" status="running" dict={dict} />);
    const badge = screen.getByText(dict.toolSteps.fallback);
    expect(badge.textContent).not.toBe("brand_new_tool");
    expect(badge.textContent.length).toBeGreaterThan(0);
  });

  it("keeps the raw identifier in data-tool for unmapped tools", () => {
    const dict = chatDictFor("en");
    const { container } = render(
      <ToolStepBadge type="tool-brand_new_tool" status="running" dict={dict} />,
    );
    const badge = container.querySelector(".chat-step");
    expect(badge?.getAttribute("data-tool")).toBe("brand_new_tool");
    expect(badge?.textContent).toBe(dict.toolSteps.fallback);
  });
});

describe("ToolStepBadge retried step", () => {
  it("renders the retried status without the error styling hook", () => {
    const dict = chatDictFor("ja");
    const { container } = render(<ToolStepBadge type="tool-search_bangumi" status="retried" dict={dict} />);
    expect(container.querySelector(".chat-step")?.getAttribute("data-status")).toBe("retried");
  });

  it.each(LOCALES)("spells the %s retried state out as text, keeping the tool name in it", (locale) => {
    const dict = chatDictFor(locale);
    const { container } = render(<ToolStepBadge type="tool-plan_route" status="retried" dict={dict} />);
    const badge = container.querySelector(".chat-step");
    expect(badge?.textContent).toContain(dict.toolSteps.labels.plan_route);
    expect(badge?.textContent).toContain(dict.toolSteps.retried);
    expect(screen.getByText(dict.toolSteps.retried).className).toBe("chat-step__note");
  });

  it("does not rely on aria-label, which is prohibited on a generic element", () => {
    const dict = chatDictFor("en");
    const { container } = render(<ToolStepBadge type="tool-plan_route" status="retried" dict={dict} />);
    expect(container.querySelector(".chat-step")?.getAttribute("aria-label")).toBeNull();
  });

  it("adds no retried note to a terminal error", () => {
    const dict = chatDictFor("en");
    const { container } = render(<ToolStepBadge type="tool-plan_route" status="error" dict={dict} />);
    expect(container.querySelector(".chat-step__note")).toBeNull();
    expect(container.querySelector(".chat-step")?.textContent).toBe(dict.toolSteps.labels.plan_route);
  });
});

describe("ToolStepBadge hidden tools", () => {
  it("suppresses translate_anime_title from the badge stream", () => {
    const dict = chatDictFor("ja");
    const { container } = render(
      <ToolStepBadge type="tool-translate_anime_title" status="done" dict={dict} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
