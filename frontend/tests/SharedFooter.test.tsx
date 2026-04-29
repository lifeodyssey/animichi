/**
 * SharedFooter — brand + clickable locale switcher.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSetLocale = vi.fn();

vi.mock("@/lib/i18n-context", () => ({
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => mockSetLocale),
}));

import SharedFooter from "@/components/layout/SharedFooter";

describe("SharedFooter", () => {
  it("renders brand name", () => {
    render(<SharedFooter />);
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
  });

  it("renders seichijunrei text", () => {
    render(<SharedFooter />);
    expect(screen.getByText("seichijunrei")).toBeInTheDocument();
  });

  it("renders locale button with current locale label", () => {
    render(<SharedFooter />);
    expect(screen.getByRole("button", { name: "日本語" })).toBeInTheDocument();
  });

  it("cycles locale on click", async () => {
    const user = userEvent.setup();
    render(<SharedFooter />);
    await user.click(screen.getByRole("button", { name: "日本語" }));
    expect(mockSetLocale).toHaveBeenCalledWith("zh");
  });

  it("renders as footer element", () => {
    const { container } = render(<SharedFooter />);
    expect(container.querySelector("footer")).not.toBeNull();
  });
});
