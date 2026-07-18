import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "../features/chat/ChatPage";
import { parseChatSearch } from "../features/chat/search";
import { LocaleProvider } from "../i18n/context";

export const Route = createFileRoute("/chat")({
  validateSearch: parseChatSearch,
  component: ChatRoute,
});

function ChatRoute() {
  const search = Route.useSearch();
  return (
    <LocaleProvider>
      <ChatPage search={search} />
    </LocaleProvider>
  );
}
