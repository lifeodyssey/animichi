import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SettingsPage } from "../components/settings/SettingsPage";
import { currentChatConfig } from "../features/chat/config";
import { chatDictFor } from "../features/chat/i18n";
import { LocaleProvider, useLocale } from "../i18n/LocaleProvider";
import { useAuthStatus } from "../lib/auth/session";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsContent() {
  const locale = useLocale();
  const config = useMemo(currentChatConfig, []);
  return <SettingsPage auth={useAuthStatus()} baseUrl={config.baseUrl} chat={chatDictFor(locale)} />;
}

function SettingsRoute() {
  return <LocaleProvider><SettingsContent /></LocaleProvider>;
}
