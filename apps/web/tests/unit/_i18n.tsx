import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "../../src/i18n/context";

/** Pin navigator.languages so the provider's mount detection is deterministic. */
export function setLanguages(langs: string[]): void {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
}

export function renderWithLocale(ui: ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}
