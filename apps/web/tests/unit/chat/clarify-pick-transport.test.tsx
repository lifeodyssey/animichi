/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { turnKeyOf, useChatSession } from "../../../src/features/chat/use-chat-session";
import type { ChatUIMessage } from "../../../src/features/chat/use-chat-session";
import { server } from "../../msw/node";
import { CHAT_URL, chatConflictHandler, chatStreamHandler } from "../../msw/chat-handlers";
import { recordingHead } from "../../msw/chat-stream-base";
import { SSE_HEADERS } from "../../msw/chat-sse";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/auth-session", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
});

const PICK = { candidateId: "115908", label: "凉宫春日的忧郁(涼宮ハルヒの憂鬱)", clarificationId: 4 };

interface TurnMessage {
  readonly id: string;
  readonly role: string;
  readonly parts: readonly { type: string; text?: string }[];
}

interface TurnBody {
  readonly selected_candidate_ids?: readonly string[];
  readonly clarification_id?: number | null;
  readonly messages?: readonly TurnMessage[];
}

interface SentTurn {
  readonly turnId: string | null;
  readonly body: Promise<TurnBody>;
}

function recordTurn(sent: SentTurn[]) {
  return (request: Request) => {
    sent.push({ turnId: request.headers.get("x-turn-id"), body: request.clone().json() as Promise<TurnBody> });
  };
}

/** Streams the recording head, then drops mid-stream — the turn never finishes. */
function droppingChatHandler(sent: SentTurn[]) {
  return http.post(CHAT_URL, ({ request }) => {
    recordTurn(sent)(request);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(recordingHead("search")));
        controller.error(new Error("connection lost"));
      },
    });
    return new HttpResponse(body, { headers: SSE_HEADERS });
  });
}

function renderSession() {
  return renderHook(() => useChatSession(CHAT_URL));
}

describe("turnKeyOf: the message-derived idempotency rule (W1 #1220)", () => {
  const user = (id: string): ChatUIMessage => ({ id, role: "user", parts: [] });
  const assistant = (id: string): ChatUIMessage => ({ id, role: "assistant", parts: [] });

  it("derives a stable key from the LAST user message, ignoring trailing assistant partials", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
    expect(turnKeyOf(messages)).toBe("turn-u2");
    expect(turnKeyOf(messages)).toBe(turnKeyOf(messages));
  });

  it("mints a throwaway key when no user message exists to derive from", () => {
    expect(turnKeyOf([assistant("a1")])).not.toBe(turnKeyOf([assistant("a1")]));
  });
});

describe("structured clarify pick over the chat transport (W1 #1220)", () => {
  it("sends selected_candidate_ids + clarification_id with the display label as the user bubble", async () => {
    const sent: SentTurn[] = [];
    server.use(chatStreamHandler("search", { spy: recordTurn(sent) }));
    const view = renderSession();
    act(() => { view.result.current.sendCandidatePick(PICK); });
    await waitFor(() => { expect(view.result.current.status).toBe("ready"); });
    const body = await sent[0]?.body;
    expect(body?.selected_candidate_ids).toEqual(["115908"]);
    expect(body?.clarification_id).toBe(4);
    const bubble = body?.messages?.at(-1);
    expect(bubble?.role).toBe("user");
    expect(bubble?.parts[0]?.text).toBe(PICK.label);
  });

  it("derives x-turn-id from the outgoing message's own identity", async () => {
    const sent: SentTurn[] = [];
    server.use(chatStreamHandler("search", { spy: recordTurn(sent) }));
    const view = renderSession();
    act(() => { view.result.current.sendCandidatePick(PICK); });
    await waitFor(() => { expect(view.result.current.status).toBe("ready"); });
    const body = await sent[0]?.body;
    expect(sent[0]?.turnId).toBe(`turn-${body?.messages?.at(-1)?.id ?? ""}`);
  });

  // The reused-key regression the audit pinned (spec §1): the failing sequence
  // was pick → reused turn id → 409. Under connection-lifecycle key minting an
  // unfinished stream left the old key pinned for the NEXT send; the pick is a
  // NEW message, so it must never wear the interrupted turn's key.
  it("never reuses the interrupted turn's key for a pick clicked after an unfinished stream", async () => {
    const sent: SentTurn[] = [];
    server.use(droppingChatHandler(sent));
    const view = renderSession();
    act(() => { void view.result.current.sendMessage({ text: "ハルヒ" }).catch(() => undefined); });
    await waitFor(() => { expect(view.result.current.error).toBeTruthy(); });
    server.use(chatStreamHandler("search", { spy: recordTurn(sent) }));
    act(() => { view.result.current.sendCandidatePick(PICK); });
    await waitFor(() => { expect(view.result.current.status).toBe("ready"); });
    expect(sent[1]?.turnId).toBeTruthy();
    expect(sent[1]?.turnId).not.toBe(sent[0]?.turnId);
  });

  it("resends the same failed pick under the same derived key", async () => {
    const sent: SentTurn[] = [];
    // Later `use` calls take precedence: the one-shot 409 answers the pick,
    // then falls away so the stream handler answers the resend.
    server.use(chatStreamHandler("search", { spy: recordTurn(sent) }));
    server.use(chatConflictHandler("turn_in_flight", { spy: recordTurn(sent), once: true }));
    const view = renderSession();
    act(() => { view.result.current.sendCandidatePick(PICK); });
    await waitFor(() => { expect(view.result.current.error).toBeTruthy(); });
    act(() => { view.result.current.resendCandidatePick(PICK); });
    await waitFor(() => { expect(view.result.current.status).toBe("ready"); });
    const retried = await sent[1]?.body;
    expect(sent[1]?.turnId).toBe(sent[0]?.turnId);
    expect(retried?.selected_candidate_ids).toEqual(["115908"]);
    expect(retried?.clarification_id).toBe(4);
  });
});
