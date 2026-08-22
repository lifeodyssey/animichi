/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColdStart } from "../../../src/features/chat/components/ColdStart";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { leadBubbleWith } from "./_lead-bubble";

const ja = chatDictFor("ja");

afterEach(cleanup);

function renderColdStart(onChip = vi.fn()) {
  render(<ColdStart dict={ja} onChip={onChip} />);
  return onChip;
}

describe("A1 fox greeting", () => {
  it("renders the fox guide hero beside the greeting lead", () => {
    renderColdStart();
    const avatar = screen.getByAltText(ja.foxAlt);
    expect(avatar.getAttribute("src")).toBe("/images/chat/fox-guide.webp");
    expect(avatar.getAttribute("width")).toBe("108");
    expect(screen.getByText(leadBubbleWith(ja.greeting))).toBeTruthy();
  });

  it("sets the greeting's marked phrases in bold inside the one lead bubble", () => {
    renderColdStart();
    const lead = document.querySelector(".chat-cold-start__lead");
    const bold = [...(lead?.querySelectorAll("b") ?? [])].map((node) => node.textContent);
    expect(bold).toEqual([...ja.greetingEmphasis]);
    expect(lead?.textContent).toBe(ja.greeting);
  });

  it("headlines the hero and labels the chip row", () => {
    renderColdStart();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ja.heroTitle);
    expect(screen.getByText(ja.chipsLabel)).toBeTruthy();
  });
});

describe("A1 chips: tone follows meaning", () => {
  it("leaves the how-to-ask examples on the plain paper chip", () => {
    renderColdStart();
    const examples = ja.chips.filter((chip) => chip.kind === "example");
    expect(examples.length).toBeGreaterThan(0);
    for (const chip of examples) {
      expect(screen.getByRole("button", { name: chip.text }).hasAttribute("data-tone")).toBe(false);
    }
  });

  it("tones the nearby-search entry with the capability's own colour", () => {
    renderColdStart();
    const entries = ja.chips.filter((chip) => chip.kind === "nearbySearch");
    expect(entries.length).toBeGreaterThan(0);
    for (const chip of entries) {
      expect(screen.getByRole("button", { name: chip.text }).getAttribute("data-tone")).toBe("primary");
    }
  });

  it("sends the chip text when a tile is clicked", () => {
    const onChip = renderColdStart();
    fireEvent.click(screen.getByRole("button", { name: ja.chips[1].text }));
    expect(onChip).toHaveBeenCalledWith(ja.chips[1].text);
  });

  it("disables every tile while the backend is unreachable", () => {
    render(<ColdStart dict={ja} onChip={vi.fn()} disabled />);
    for (const chip of ja.chips) {
      expect(screen.getByRole("button", { name: chip.text }).hasAttribute("disabled")).toBe(true);
    }
  });
});
