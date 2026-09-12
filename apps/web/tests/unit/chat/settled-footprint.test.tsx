/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettledFootprint } from "../../../src/features/chat/components/SettledFootprint";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

afterEach(cleanup);

describe("B4 SettledFootprint", () => {
  it("collapses the pipeline into an expandable row with the elapsed time", () => {
    render(
      <SettledFootprint elapsedLabel="9.2s" dict={ja}>
        <span>resolve_anime</span>
      </SettledFootprint>,
    );
    expect(screen.getByText("9.2s")).toBeTruthy();
    expect(screen.getByText(ja.footprintDetails, { exact: false })).toBeTruthy();
  });

  it("opens and closes the activity with the keyboard and exposes its state", async () => {
    const user = userEvent.setup();
    render(
      <SettledFootprint elapsedLabel="9.2s" dict={ja}>
        <span>plan_route</span>
      </SettledFootprint>,
    );
    const trigger = screen.getByRole("button", { name: /調べたこと/u });
    const content = screen.getByText("plan_route").closest("[id]");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(content?.id);
    expect(content?.hasAttribute("hidden")).toBe(true);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hasAttribute("hidden")).toBe(false);
    await user.keyboard(" ");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content?.hasAttribute("hidden")).toBe(true);
  });

  it("omits the elapsed emphasis when no duration is known", () => {
    const { container } = render(
      <SettledFootprint dict={ja}>
        <span>search_bangumi</span>
      </SettledFootprint>,
    );
    expect(container.querySelector(".chat-settled__elapsed")).toBeNull();
  });
});
