import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  useRouterState,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import { ChatPage } from "../../../src/features/chat/ChatPage";
import { ChatEntryGate } from "../../../src/features/chat/ChatEntryGate";
import { parseChatSearch } from "../../../src/features/chat/search";
import type { ChatSearch } from "../../../src/features/chat/search";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { server } from "../../msw/node";
import { healthzOkHandler } from "../../msw/chat-handlers";

afterEach(cleanup);

// jsdom does not implement scrollIntoView; the anchor effect needs a stub.
Element.prototype.scrollIntoView = () => undefined;

const EMPTY_SEARCH: ChatSearch = { q: undefined, session: undefined, route: undefined };

// The chat feature writes URL-owned state (issue #1009 AC4: the BYOK panel)
// through the router context. The tree holds a single `/chat` route so those
// navigations resolve; the harness hands the router's own URL search to
// ChatPage (via RouterContextProvider + useRouterState), so a toggle that
// writes the URL re-renders the page the way the real route's `useSearch`
// would — no local state anywhere.
const testRoot = createRootRoute();

const testTree = testRoot.addChildren([
  createRoute({ getParentRoute: () => testRoot, path: "/chat" }),
]);

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

/** Render the chat page with a fresh QueryClient; healthz answers OK by default. */
export function renderChatPage(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: testTree,
    history: createMemoryHistory({ initialEntries: [searchHref(search)] }),
  });
  render(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <ChatHarness />
        </LocaleProvider>
      </QueryClientProvider>
    </RouterContextProvider>,
  );
  return router;
}

export function renderChatEntry(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: testTree,
    history: createMemoryHistory({ initialEntries: [searchHref(search)] }),
  });
  render(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider><EntryHarness /></LocaleProvider>
      </QueryClientProvider>
    </RouterContextProvider>,
  );
  return router;
}

function searchHref(search: ChatSearch): string {
  const params = new URLSearchParams();
  if (search.q !== undefined) params.set("q", search.q);
  if (search.session !== undefined) params.set("session", search.session);
  if (search.route !== undefined) params.set("route", search.route);
  if (search.settings !== undefined) params.set("settings", search.settings);
  const query = params.toString();
  return query === "" ? "/chat" : `/chat?${query}`;
}

/** The `?settings=` value the router URL currently carries. */
export function urlSettings(router: TestRouter): "byok" | undefined {
  const search = router.state.location.search as Readonly<Record<string, unknown>>;
  return search.settings === "byok" ? "byok" : undefined;
}

interface TestRouter {
  state: { location: { search: unknown } };
}
