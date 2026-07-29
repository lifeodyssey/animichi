/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSearch } from "../../src/components/landing/HeroSearch";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("HeroSearch", () => {
  it("submits the typed query from the CTA button", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<HeroSearch onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox", { name: "アニメ・駅・都市を入力" }), {
      target: { value: "  君の名は。 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "巡礼をはじめる" }));
    expect(onSubmit).toHaveBeenCalledWith("君の名は。");
  });

  it("submits the typed query when Enter is pressed", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<HeroSearch onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "アニメ・駅・都市を入力" });
    fireEvent.change(input, { target: { value: "須賀神社" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("須賀神社");
  });

  it("fills the input and submits when an example chip is tapped", () => {
    const onSubmit = vi.fn();
    renderWithLocale(<HeroSearch onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "響け！ユーフォニアム" }));
    const input = screen.getByRole("textbox", { name: "アニメ・駅・都市を入力" });
    expect((input as HTMLInputElement).value).toBe("響け！ユーフォニアム");
    expect(onSubmit).toHaveBeenCalledWith("響け！ユーフォニアム");
  });

  it("renders the try-an-example label with all three example chips", () => {
    renderWithLocale(<HeroSearch onSubmit={vi.fn()} />);
    expect(screen.getByText("例から試す")).toBeTruthy();
    expect(screen.getByRole("button", { name: "君の名は。" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "天気の子" })).toBeTruthy();
  });
});
