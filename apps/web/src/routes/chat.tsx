import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "../features/chat/ChatPage";
import { ChatEntryGate } from "../features/chat/ChatEntryGate";
import { parseChatSearch } from "../features/chat/search";
import { useSplashRelease } from "../features/splash/splash-release";
import { LocaleProvider } from "../i18n/LocaleProvider";

export const Route = createFileRoute("/chat")({
  validateSearch: parseChatSearch,
  component: ChatRoute,
});

/** Chat is the mobile hand-off destination, so painting it is what releases the
 * splash still covering `/` (owner 2026-08-23). Nothing else may be exported
 * from this file: the route splitter keeps only `component` out of the entry
 * chunk, and a second export would drag ChatPage back into it. */
function ChatRoute() {
  useSplashRelease();
  const search = Route.useSearch();
  return (
    <LocaleProvider>
      <ChatEntryGate><ChatPage search={search} /></ChatEntryGate>
    </LocaleProvider>
  );
}
