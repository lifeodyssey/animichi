import { createFileRoute } from "@tanstack/react-router";
import { AppPreferences } from "../components/settings/AppPreferences";
import { ChatPage } from "../features/chat/ChatPage";
import { ChatEntryGate } from "../features/chat/ChatEntryGate";
import { parseChatSearch } from "../features/chat/search";
import type { ChatSearch } from "../features/chat/search";
import { useSplashRelease } from "../features/splash/splash-release";
import { LocaleProvider, useDict } from "../i18n/LocaleProvider";

export const Route = createFileRoute("/chat")({
  validateSearch: parseChatSearch,
  component: ChatRoute,
});

/** The settings drawer's app-preference section is composed HERE, at the UI layer, and
 * handed to the chat feature as a node — chat rents the panel, it does not own
 * language or day/night (see `AppPreferences`). */
function ChatWithSettings({ search }: Readonly<{ search: ChatSearch }>) {
  const settings = useDict().settings;
  return <ChatPage search={search} preferences={{ label: settings.title, content: <AppPreferences /> }} />;
}

/** Chat is the mobile hand-off destination, so painting it is what releases the
 * splash still covering `/` (owner 2026-08-23). Nothing else may be exported
 * from this file: the route splitter keeps only `component` out of the entry
 * chunk, and a second export would drag ChatPage back into it. */
function ChatRoute() {
  useSplashRelease();
  const search = Route.useSearch();
  return (
    <LocaleProvider>
      <ChatEntryGate><ChatWithSettings search={search} /></ChatEntryGate>
    </LocaleProvider>
  );
}
