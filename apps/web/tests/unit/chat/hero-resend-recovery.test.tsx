/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { server } from "../../msw/node";
import { CHAT_URL, chatStreamHandler, streamText } from "../../msw/chat-handlers";
import { sseResponse } from "../../msw/chat-sse";
import { setLanguages } from "../_i18n";
import { chatNavigation, chatSearch } from "./_chat-page";

const ja = chatDictFor("ja");
const ROUTE_CARD_TEXT = "宇治の聖地を2件、徒歩ルートにまとめました。";

beforeEach(() => { setLanguages(["ja"]); });

interface PostedTurn {
  readonly session: string | null;
  readonly turn: string | null;
}

function recordingPosts() {
  const posts: PostedTurn[] = [];
  const record = (request: Request): void => {
    posts.push({ session: request.headers.get("x-session-id"), turn: request.headers.get("x-turn-id") });
  };
  return { posts, record };
}

function sendFromComposer(text: string): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

function historyMessagesHandler(calls: string[], status: number, once = false) {
  return http.get("*/v1/conversations/:sessionId/messages", ({ request }) => {
    calls.push(request.url);
    return status === 200
      ? HttpResponse.json({ messages: [], revision: 0, next_offset: null })
      : new HttpResponse(null, { status });
  }, { once });
}

/**
 * CodeRabbit on #1926 (major): the remount reconnected fine — its messages
 * streamed in — so a LATER turn's 404 is that turn's own honest D18, never a
 * cue to ask the hero query again. The resend belongs to an empty chat only.
 */
it("keeps a later turn's 404 as its own failure instead of resending the hero query", async () => {
  const { posts, record } = recordingPosts();
  server.use(
    http.post(CHAT_URL, ({ request }) => {
      record(request);
      return sseResponse(streamText("search", { sessionId: request.headers.get("x-session-id") ?? undefined }));
    }, { once: true }),
    http.post(CHAT_URL, ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 404 });
    }),
    http.get("*/v1/conversations/:sessionId/stream", ({ params }) =>
      sseResponse(streamText("search", { sessionId: String(params.sessionId) }))),
    historyMessagesHandler([], 200),
  );
  const visit = chatNavigation(chatSearch({ q: "ハルヒ" }));
  const first = visit.mount();
  await screen.findAllByText(ROUTE_CARD_TEXT);
  first.unmount();
  visit.mount();
  await screen.findAllByText(ROUTE_CARD_TEXT);
  sendFromComposer("もう一件");
  await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain(ja.errorStates.d18Title); });
  expect(posts).toHaveLength(2);
  expect(posts.filter((post) => post.turn === posts[0]?.turn)).toHaveLength(1);
});

/**
 * CodeRabbit on #1926 (minor): the remount whose first POST never landed gets
 * a 404 from history too, and the resend clears only the chat error — the A3
 * gate stays locked behind the stale history error. Once the resent turn has
 * settled the session exists, so history is refetched and the gate unlocks.
 */
it("refetches history once the reconnect-404 resend has settled", async () => {
  const { posts, record } = recordingPosts();
  const historyCalls: string[] = [];
  server.use(
    http.post(CHAT_URL, ({ request }) => {
      record(request);
      return HttpResponse.error();
    }, { once: true }),
    chatStreamHandler("search", { spy: record }),
    http.get("*/v1/conversations/:sessionId/stream", () => new HttpResponse(null, { status: 404 })),
    historyMessagesHandler(historyCalls, 404, true),
    historyMessagesHandler(historyCalls, 200),
  );
  const visit = chatNavigation(chatSearch({ q: "ハルヒ" }));
  const first = visit.mount();
  await waitFor(() => { expect(posts).toHaveLength(1); });
  first.unmount();
  visit.mount();
  await waitFor(() => { expect(posts).toHaveLength(2); });
  await screen.findAllByText(ROUTE_CARD_TEXT);
  await waitFor(() => { expect(historyCalls).toHaveLength(2); });
  await waitFor(() => { expect(screen.queryByRole("alert")).toBeNull(); });
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
});
