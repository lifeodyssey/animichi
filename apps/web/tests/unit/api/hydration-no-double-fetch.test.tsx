/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { JsonBodyType } from "msw";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListSavedRoutesResult } from "@animichi/contract";
import { users } from "../../../src/api/orpc";
import { makeQueryClient } from "../../../src/api/query-client";
import { useContinueFrom } from "../../../src/api/hooks/use-continue-from";
import { server } from "../../msw/node";
import { draftRoute, USERS_SAVED_ROUTES_URL } from "../../msw/users";

/**
 * AC3 unit leg: the SSR request cache is isolated per request
 * (`makeQueryClient`), and the dehydrated cache hydrates the client instead of
 * refetching — `routerWithQueryClient` wires `dehydrate`/`hydrate`, so this is
 * the exact handoff the emitted Worker performs between its server render and
 * the browser's first render. The counting handler proves the fetch count:
 * zero after hydration, one for a cold client.
 *
 * The suite pins a deterministic fixed clock (issue #1009 review) so the
 * hydration handoff never depends on wall-clock time.
 */

const FIXED_NOW = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});

function countingSavedRoutesHandler(counter: { readonly calls: () => void }): ReturnType<typeof http.get> {
  return http.get(USERS_SAVED_ROUTES_URL, () => {
    counter.calls();
    return HttpResponse.json(ListSavedRoutesResult.parse({ saved_routes: [draftRoute] }) as JsonBodyType);
  });
}

function renderContinueFrom(client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <ContinueFromValue />
    </QueryClientProvider>,
  );
}

function ContinueFromValue() {
  const state = useContinueFrom();
  return <p>{state.route?.title ?? "no draft"}</p>;
}

describe("AC3: hydration serves the dehydrated cache without a double fetch", () => {
  it("renders from the hydrated cache with zero network calls", async () => {
    let fetchCount = 0;
    server.use(countingSavedRoutesHandler({ calls: () => { fetchCount += 1; } }));
    const serverClient = makeQueryClient();
    serverClient.setQueryData(users().listSavedRoutes.queryKey(), { saved_routes: [draftRoute] });
    const dehydrated = dehydrate(serverClient);
    const client = makeQueryClient();
    hydrate(client, dehydrated);
    renderContinueFrom(client);
    expect(await screen.findByText("Uji × Euphonium")).toBeTruthy();
    expect(fetchCount).toBe(0);
  });

  it("a cold client fetches exactly once", async () => {
    let fetchCount = 0;
    server.use(countingSavedRoutesHandler({ calls: () => { fetchCount += 1; } }));
    renderContinueFrom(makeQueryClient());
    expect(await screen.findByText("Uji × Euphonium")).toBeTruthy();
    expect(fetchCount).toBe(1);
  });
});
