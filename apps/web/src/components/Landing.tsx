import { LocaleProvider } from "../i18n/context";
import { LandingPage } from "./landing/LandingPage";

/** Landing entry: provides the i18n context to the marketing page. */
export function Landing() {
  return (
    <LocaleProvider>
      <LandingPage />
    </LocaleProvider>
  );
}
