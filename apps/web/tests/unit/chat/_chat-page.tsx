import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import { ChatPage } from "../../../src/features/chat/ChatPage";
import type { ChatSearch } from "../../../src/features/chat/search";
import { LocaleProvider } from "../../../src/i18n/context";
import { server } from "../../msw/node";
import { healthzOkHandler } from "../../msw/chat-handlers";

afterEach(cleanup);

// jsdom does not implement scrollIntoView; the anchor effect needs a stub.
Element.prototype.scrollIntoView = () => undefined;

const EMPTY_SEARCH: ChatSearch = { q: undefined, session: undefined, route: undefined };

export function chatSearch(overrides: Partial<ChatSearch> = {}): ChatSearch {
  return { ...EMPTY_SEARCH, ...overrides };
}

/** Render the chat page with a fresh QueryClient; healthz answers OK by default. */
export function renderChatPage(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ChatPage search={search} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
