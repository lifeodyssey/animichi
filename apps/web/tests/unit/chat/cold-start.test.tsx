/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColdStart } from "../../../src/features/chat/components/ColdStart";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

afterEach(cleanup);

function renderColdStart(onChip = vi.fn()) {
  render(<ColdStart dict={ja} onChip={onChip} />);
  return onChip;
}

describe("A1 fox greeting", () => {
  it("renders the fox guide avatar beside the greeting bubble", () => {
    renderColdStart();
    const avatar = screen.getByAltText(ja.foxAlt);
    expect(avatar.getAttribute("src")).toBe("/images/chat/fox-guide.webp");
    expect(screen.getByText(ja.greeting)).toBeTruthy();
  });
});

describe("A1 nook tri-color chips", () => {
  it("renders the three example chips as explore/walk/primary tiles", () => {
    renderColdStart();
    const tones = ja.chips.map(
      (chip) => screen.getByRole("button", { name: chip }).getAttribute("data-tone"),
    );
    expect(tones).toEqual(["explore", "walk", "primary"]);
  });

  it("sends the chip text when a tile is clicked", () => {
    const onChip = renderColdStart();
    fireEvent.click(screen.getByRole("button", { name: ja.chips[1] }));
    expect(onChip).toHaveBeenCalledWith(ja.chips[1]);
  });

  it("disables every tile while the backend is unreachable", () => {
    render(<ColdStart dict={ja} onChip={vi.fn()} disabled />);
    for (const chip of ja.chips) {
      expect(screen.getByRole("button", { name: chip }).hasAttribute("disabled")).toBe(true);
    }
  });
});
