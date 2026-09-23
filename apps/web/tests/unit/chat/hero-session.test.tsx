/** @vitest-environment jsdom */
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, onTestFinished } from "vitest";
import { parseChatSearch } from "../../../src/features/chat/search";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler, healthzControlledHandler, streamText } from "../../msw/chat-handlers";
import { sseResponse } from "../../msw/chat-sse";
import { chatTurnsAnswered } from "../../msw/chat-answered";
import { drainInFlightRequests, expectAbandonedRequests } from "../../msw/in-flight-requests";
import { setLanguages } from "../_i18n";
import { chatNavigation, chatSearch } from "./_chat-page";
import { preparedNativeWatch } from "./_native-watch";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const ROUTE_CARD_TEXT = "宇治の聖地を2件、徒歩ルートにまとめました。";

beforeEach(() => { setLanguages(["ja"]); });

function addressSession(visit: ReturnType<typeof chatNavigation>): string | undefined {
  return parseChatSearch(visit.router.state.location.search as Record<string, unknown>).session;
}

function historyStub() {
  return http.get("*/v1/conversations/:sessionId/messages", () =>
    HttpResponse.json({ messages: [], revision: 0, next_offset: null }));
}

/**
 * #1901 AC1. The probe is held so "before the POST leaves" is a state, not a
 * race: the minted id must already ride the address (replace — the history
 * keeps its one entry) while no request has gone out, and the POST that the
 * released probe lets through must carry that same id. The recording echoes
 * the request's id, so the last assertion also pins that nothing re-scopes
 * when the answer arrives.
 */
it("mints the session id into the address before the hero POST leaves", async () => {
  const probe = healthzControlledHandler();
  const posts: Request[] = [];
  const reads: string[] = [];
  server.use(
    probe.handler,
    http.post(CHAT_URL, ({ request }) => {
      posts.push(request);
      return sseResponse(streamText("search", { sessionId: request.headers.get("x-session-id") ?? undefined }));
    }),
    http.get("*/v1/conversations/:sessionId/stream", ({ request }) => {
      reads.push(request.url);
      return new HttpResponse(null, { status: 404 });
    }),
    historyStub(),
  );
  const visit = chatNavigation(chatSearch({ q: "ハルヒ" }), false);
  visit.mount();
  await waitFor(() => { expect(addressSession(visit)).toMatch(UUID); });
  expect(visit.router.history.length).toBe(1);
  expect(posts).toEqual([]);
  expect(reads).toEqual([]);
  expectAbandonedRequests(1);
  await drainInFlightRequests();
  const answered = chatTurnsAnswered(1);
  probe.release();
  await answered;
  expect(posts[0]?.headers.get("x-session-id")).toBe(addressSession(visit));
  expect(await screen.findAllByText(ROUTE_CARD_TEXT)).not.toHaveLength(0);
  expect(addressSession(visit)).toBe(posts[0]?.headers.get("x-session-id"));
});

/**
 * #1901 AC2. The first mount's POST is a native watch still undriven — the
 * answer is in flight at the remount. The remounted page must not ask again:
 * one POST across both mounts, a reconnect GET on the minted id, and the
 * answer rendered from that stream.
 */
it("reattaches to the in-flight answer after a remount instead of asking again", async () => {
  const posts: string[] = [];
  const reconnects: string[] = [];
  let native: Awaited<ReturnType<typeof preparedNativeWatch>> | undefined;
  onTestFinished(async () => { await native?.close(); });
  server.use(
    http.post(CHAT_URL, async ({ request }) => {
      posts.push(request.headers.get("x-session-id") ?? "");
      native = await preparedNativeWatch("Native recovered answer", posts[0]);
      return native.response();
    }),
    http.get("*/v1/conversations/:sessionId/stream", ({ params, request }) => {
      reconnects.push(new URL(request.url).pathname);
      return sseResponse(streamText("search", { sessionId: String(params.sessionId) }));
    }),
    historyStub(),
  );
  const visit = chatNavigation(chatSearch({ q: "ハルヒ" }));
  const first = visit.mount();
  await waitFor(() => { expect(posts).toHaveLength(1); });
  first.unmount();
  visit.mount();
  await waitFor(() => { expect(reconnects).toHaveLength(1); });
  expect(reconnects[0]).toBe(`/v1/conversations/${posts[0] ?? ""}/stream`);
  expect(await screen.findAllByText(ROUTE_CARD_TEXT)).not.toHaveLength(0);
  expect(posts).toHaveLength(1);
});

/**
 * #1901 AC3. The first POST errors out — it never reached the edge — so the
 * remount's reconnect answers 404 and the page sends the hero query again.
 * Both POSTs must carry the SAME `x-session-id` and the SAME `x-turn-id`: had
 * the first one landed, the edge would replay it instead of admitting a
 * second turn (`request-intent.ts`).
 */
it("resends the hero query with the same session and turn ids when the reconnect answers 404", async () => {
  const posts: { readonly session: string | null; readonly turn: string | null }[] = [];
  const record = (request: Request): void => {
    posts.push({ session: request.headers.get("x-session-id"), turn: request.headers.get("x-turn-id") });
  };
  server.use(
    http.post(CHAT_URL, ({ request }) => { record(request); return HttpResponse.error(); }, { once: true }),
    chatStreamHandler("search", { spy: record }),
    http.get("*/v1/conversations/:sessionId/stream", () => new HttpResponse(null, { status: 404 })),
    http.get("*/v1/conversations/:sessionId/messages", () => new HttpResponse(null, { status: 404 })),
  );
  const visit = chatNavigation(chatSearch({ q: "ハルヒ" }));
  const first = visit.mount();
  await waitFor(() => { expect(posts).toHaveLength(1); });
  first.unmount();
  visit.mount();
  await waitFor(() => { expect(posts).toHaveLength(2); });
  expect(posts[0]).toEqual(posts[1]);
  expect(posts[1]?.session).toMatch(UUID);
  expect(posts[1]?.turn).toBe(`turn-hero-${posts[1]?.session ?? ""}`);
  expect(await screen.findAllByText(ROUTE_CARD_TEXT)).not.toHaveLength(0);
});
