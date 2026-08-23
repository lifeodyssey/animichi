/**
 * @vitest-environment jsdom
 *
 * The language control's contract, asserted through what the visitor sees:
 * picking a language must actually re-render the app in it, and must be
 * remembered so the next visit starts there. `LOCALE_LABELS` is the single
 * label source, so the options are the labels — no second copy.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanguageSelect } from "../../../src/components/settings/LanguageSelect";
import { LOCALE_STORAGE_KEY } from "../../../src/lib/i18n/locale-storage";
import { dictFor } from "../../../src/i18n/dictionaries";
import { LocaleProvider, useDict } from "../../../src/i18n/LocaleProvider";
import { setLanguages } from "../_i18n";

beforeEach(() => {
  window.localStorage.clear();
  setLanguages(["ja-JP"]);
});
afterEach(cleanup);

/** The switcher beside a live sample of the dictionary it drives. */
function LanguageProbe() {
  return <><LanguageSelect /><p data-testid="lead">{useDict().doorway.lead}</p></>;
}

function renderProbe() {
  render(<LocaleProvider><LanguageProbe /></LocaleProvider>);
}

function chooseEnglish(): void {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "EN" }));
}

describe("LanguageSelect — the browser guess is the starting point", () => {
  it("shows the browser's language when nothing was ever chosen", () => {
    renderProbe();
    expect(screen.getByRole("combobox").textContent).toContain("日本語");
  });

  it("offers exactly the three shipped languages, by their own labels", () => {
    renderProbe();
    fireEvent.click(screen.getByRole("combobox"));
    const labels = screen.getAllByRole("option").map((option) => option.textContent);
    expect(labels).toEqual(["日本語", "中文", "EN"]);
  });
});

describe("LanguageSelect — a manual choice takes effect and outranks the browser", () => {
  it("re-renders the app copy in the chosen language", () => {
    renderProbe();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "中文" }));
    expect(screen.getByTestId("lead").textContent).toBe(dictFor("zh").doorway.lead);
  });

  it("moves the trigger and the document language with it", () => {
    renderProbe();
    chooseEnglish();
    expect(screen.getByRole("combobox").textContent).toContain("EN");
    expect(document.documentElement.lang).toBe("en");
  });

  it("records the choice under the locale key", () => {
    renderProbe();
    chooseEnglish();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("starts from the recorded choice next time, not from the browser", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    renderProbe();
    expect(screen.getByTestId("lead").textContent).toBe(dictFor("en").doorway.lead);
    expect(screen.getByRole("combobox").textContent).toContain("EN");
  });

  it("ignores a stored value that is not a shipped language", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    renderProbe();
    expect(screen.getByTestId("lead").textContent).toBe(dictFor("ja").doorway.lead);
  });
});
