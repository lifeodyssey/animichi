import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "../components/legal/PrivacyPolicy";
import { LocaleProvider } from "../i18n/LocaleProvider";

export const Route = createFileRoute("/privacy")({ component: PrivacyRoute });

function PrivacyRoute() {
  return <LocaleProvider><PrivacyPolicy /></LocaleProvider>;
}
