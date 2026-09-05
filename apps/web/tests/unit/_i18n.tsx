import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "../../src/i18n/LocaleProvider";
import { AppRouterContext } from "./_router";

/** Pin navigator.languages so the provider's mount detection is deterministic. */
export function setLanguages(langs: string[]): void {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
}

/** Locale plus the router context every internal `<Link>` needs (#1337). */
export function renderWithLocale(ui: ReactElement) {
  return render(<AppRouterContext><LocaleProvider>{ui}</LocaleProvider></AppRouterContext>);
}
