/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocaleProvider, useDict, useLocale, useSetLocale } from "../../src/i18n/context";
import { setLanguages } from "./_i18n";

function Probe() {
  const dict = useDict();
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="cta">{dict.landing.cta}</span>
      <button type="button" onClick={() => { setLocale("en"); }}>go-en</button>
    </div>
  );
}

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("i18n context", () => {
  it("provides the ja default and updates html lang", () => {
    render(<LocaleProvider><Probe /></LocaleProvider>);
    expect(screen.getByTestId("locale").textContent).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("switches locale, dictionary, and html lang together", () => {
    render(<LocaleProvider><Probe /></LocaleProvider>);
    act(() => { screen.getByRole("button", { name: "go-en" }).click(); });
    expect(screen.getByTestId("cta").textContent).toBe("Start Exploring");
    expect(document.documentElement.lang).toBe("en");
  });

  it("throws when hooks are used outside a provider", () => {
    expect(() => renderHook(() => useDict())).toThrow(/LocaleProvider/u);
  });
});
