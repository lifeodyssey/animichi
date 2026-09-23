import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, useRouterState } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChatPage } from "../../../src/features/chat/ChatPage";
import { ChatEntryGate } from "../../../src/features/chat/ChatEntryGate";
import { parseChatSearch } from "../../../src/features/chat/search";
import type { ChatSearch } from "../../../src/features/chat/search";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { server } from "../../msw/node";
import { healthzOkHandler } from "../../msw/chat-handlers";
import { makeAppRouter } from "../_router";

// jsdom does not implement scrollIntoView; the anchor effect needs a stub.
Element.prototype.scrollIntoView = () => undefined;

const EMPTY_SEARCH: ChatSearch = { q: undefined, session: undefined, route: undefined };

// The harness hands the router's URL search to ChatPage exactly as the real
// route does, without any second local owner.
function ChatHarness() {
  const search = parseChatSearch(useRouterState({ select: (state) => state.location.search }));
  return <ChatPage search={search} />;
}

function EntryHarness() {
  const search = parseChatSearch(useRouterState({ select: (state) => state.location.search }));
  return <ChatEntryGate><ChatPage search={search} /></ChatEntryGate>;
}

export function chatSearch(overrides: Partial<ChatSearch> = {}): ChatSearch {
  return { ...EMPTY_SEARCH, ...overrides };
}

type Providers = Readonly<{ router: ReturnType<typeof makeAppRouter>; client: QueryClient; children: ReactNode }>;

/** The app-level providers the page runs under, in `src/router.tsx`'s own order. */
function ChatProviders({ router, client, children }: Providers) {
  return (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={client}>
        <LocaleProvider>{children}</LocaleProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  );
}

function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * One visit to `/chat`, whose history entry and query cache outlive any single
 * mount of the page — as they do in the app, where `src/router.tsx` puts both
 * on the router rather than inside the page.
 *
 * `mount()` more than once is how a case reaches a REMOUNT: the second call
 * gets a fresh `ChatPage` (and so a fresh `useAutoSend` ref) over the cache the
 * first one warmed, which is what Back/Forward does to this page (#1512).
 */
export function chatNavigation(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const client = testQueryClient();
  const router = makeAppRouter(searchHref(search));
  const mount = () => render(<ChatProviders router={router} client={client}><ChatHarness /></ChatProviders>);
  return { router, mount };
}

/** Render the chat page with a fresh QueryClient; healthz answers OK by default. */
export function renderChatPage(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  const visit = chatNavigation(search, healthy);
  visit.mount();
  return visit.router;
}

export function renderChatEntry(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const router = makeAppRouter(searchHref(search));
  render(<ChatProviders router={router} client={testQueryClient()}><EntryHarness /></ChatProviders>);
  return router;
}

function searchHref(search: ChatSearch): string {
  const params = new URLSearchParams();
  if (search.q !== undefined) params.set("q", search.q);
  if (search.session !== undefined) params.set("session", search.session);
  if (search.route !== undefined) params.set("route", search.route);
  const query = params.toString();
  return query === "" ? "/chat" : `/chat?${query}`;
}
