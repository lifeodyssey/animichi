/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "../../../src/components/home/SearchBox";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("SearchBox", () => {
  it("submits the typed query when the button is clicked", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<SearchBox onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Your Name" } });
    fireEvent.click(screen.getByRole("button", { name: "ルートを作る" }));
    expect(onSubmit).toHaveBeenCalledWith("Your Name");
  });

  it("submits when the user presses Enter", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<SearchBox onSubmit={onSubmit} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Euphonium" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Euphonium");
  });

  it("does not submit on other keys", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<SearchBox onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "a" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
