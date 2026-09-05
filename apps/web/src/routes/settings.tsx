import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SettingsPage } from "../components/settings/SettingsPage";
import { currentChatConfig } from "../features/chat/config";
import { chatDictFor } from "../features/chat/i18n";
import { stringParam } from "../lib/search-params";
import { LocaleProvider, useLocale } from "../i18n/LocaleProvider";
import { useAuthStatus } from "../lib/auth/session";

/** `?session=`: the conversation the visitor came from, carried in so the back
 * link returns to it instead of a fresh draft (#1337). */
function parseSettingsSearch(input: Record<string, unknown>): { readonly session?: string } {
  return { session: stringParam(input.session) };
}

export const Route = createFileRoute("/settings")({ validateSearch: parseSettingsSearch, component: SettingsRoute });

function SettingsContent() {
  const locale = useLocale();
  const config = useMemo(currentChatConfig, []);
  const { session } = Route.useSearch();
  return <SettingsPage auth={useAuthStatus()} baseUrl={config.baseUrl} chat={chatDictFor(locale)} session={session} />;
}

function SettingsRoute() {
  return <LocaleProvider><SettingsContent /></LocaleProvider>;
}
