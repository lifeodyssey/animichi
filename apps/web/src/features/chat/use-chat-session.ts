import { Chat, useChat } from "@ai-sdk/react";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatResponseDataPart } from "@seichijunrei/contract";
import type { ChatDataPart } from "@seichijunrei/contract";
import { DefaultChatTransport, generateId } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import type { SelectedPointsBody } from "../../lib/chat/selectedPointsBypass";
import { sessionHeaders } from "./session-headers";

/**
 * Typed UI message: the `data-response` part carries the contract envelope,
 * so streamed frames are schema-validated by the AI SDK before they can
 * overwrite an existing same-ID part (`dataPartSchemas`).
 */
export type ChatUIMessage = UIMessage<unknown, { response: ChatDataPart }>;

// ai@6.0.225 looks the schema up by the stripped name ("response") when
// validating whole messages but by the full chunk type ("data-response")
// while streaming, so the schema is registered under both keys.
const dataPartSchemas = {
  response: ChatResponseDataPart,
  "data-response": ChatResponseDataPart,
};

interface SessionTracker {
  scope: string;
  id: string | undefined;
  lastHttpStatus: number | undefined;
  lastErrorCode: string | undefined;
  /** D12's `quota_resets_at`: when this identity's allowance returns. */
  lastQuotaResetsAt: string | undefined;
}
type SessionRef = RefObject<SessionTracker>;

function emptyTracker(scope: string, sessionId: string | undefined): SessionTracker {
  return {
    scope,
    id: sessionId,
    lastHttpStatus: undefined,
    lastErrorCode: undefined,
    lastQuotaResetsAt: undefined,
  };
}

function scopeOf(sessionId?: string): string {
  return `chat:${sessionId ?? "draft"}`;
}

/** Track the server-assigned session id, reset whenever the URL identity changes. */
function useSessionTracker(sessionId: string | undefined, scope: string): SessionRef {
  const ref = useRef<SessionTracker>(emptyTracker(scope, sessionId));
  if (ref.current.scope !== scope) {
    ref.current = emptyTracker(scope, sessionId);
  }
  return ref;
}

function captureSessionId(ref: SessionRef, part: Readonly<{ data: ChatDataPart }>): void {
  const id = part.data.session_id;
  if (typeof id === "string" && id !== "") ref.current.id = id;
}

/**
 * A Chat whose transport and onData are fixed at construction: `scope` is the
 * immutable epoch. `useChat`'s own onData delegates through a latest-render
 * ref, so a late frame from a previous scope's stream would invoke the new
 * scope's callback; constructing the Chat ourselves pins the callback to its
 * epoch, and the guard drops frames once the tracker moved to another scope.
 */
function createScopedChat(chatUrl: string, scope: string, ref: SessionRef): Chat<ChatUIMessage> {
  return new Chat<ChatUIMessage>({
    id: scope,
    transport: createSessionTransport(chatUrl, ref),
    dataPartSchemas,
    onData: (part) => {
      if (ref.current.scope === scope) captureSessionId(ref, part);
    },
  });
}

/** The rejection envelope's shape, as far as classification needs it. */
interface RejectionDetail {
  readonly code: string | undefined;
  readonly quotaResetsAt: string | undefined;
}

const NO_REJECTION: RejectionDetail = { code: undefined, quotaResetsAt: undefined };

function errorObjectOf(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error: unknown = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return error as Record<string, unknown>;
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value: unknown = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function rejectionOf(body: unknown): RejectionDetail {
  const error = errorObjectOf(body);
  if (error === undefined) return NO_REJECTION;
  const data = errorObjectOf({ error: error.data }) ?? error;
  return { code: stringField(error, "code"), quotaResetsAt: stringField(data, "quota_resets_at") };
}

/**
 * Read the rejection's error code — which separates D8 (401/403 expiry) from
 * D11 (`anon_budget_exhausted`) and D12 (`anon_quota_exhausted`) — plus D12's
 * `quota_resets_at`, read from `error.data` or flat on `error`. Only failures
 * are parsed; a streaming 2xx body is never touched, let alone buffered.
 */
async function readRejection(response: Response): Promise<RejectionDetail> {
  if (response.ok) return NO_REJECTION;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  return rejectionOf(body);
}

function clearRejection(ref: SessionRef): void {
  ref.current.lastHttpStatus = undefined;
  ref.current.lastErrorCode = undefined;
  ref.current.lastQuotaResetsAt = undefined;
}

function recordRejection(ref: SessionRef, response: Response, rejection: RejectionDetail): void {
  ref.current.lastErrorCode = rejection.code;
  ref.current.lastQuotaResetsAt = rejection.quotaResetsAt;
  ref.current.lastHttpStatus = response.status;
}

/** Record each chat response's status and rejection detail so failures classify. */
function createTrackingFetch(ref: SessionRef): typeof globalThis.fetch {
  return async (input, init) => {
    clearRejection(ref);
    const response = await globalThis.fetch(input, init);
    recordRejection(ref, response, await readRejection(response));
    return response;
  };
}

function createSessionTransport(chatUrl: string, ref: SessionRef): DefaultChatTransport<ChatUIMessage> {
  return new DefaultChatTransport({
    api: chatUrl,
    headers: () => sessionHeaders(ref.current.id),
    fetch: createTrackingFetch(ref),
  });
}

interface ScopedChat {
  scope: string;
  chat: Chat<ChatUIMessage>;
}

/** Stop the outgoing scope's stream before the next scope's chat takes over. */
function switchScopedChat(
  previous: ScopedChat | null,
  chatUrl: string,
  scope: string,
  ref: SessionRef,
): ScopedChat {
  void previous?.chat.stop();
  return { scope, chat: createScopedChat(chatUrl, scope, ref) };
}

function useScopedChat(chatUrl: string, scope: string, ref: SessionRef): Chat<ChatUIMessage> {
  const holder = useRef<ScopedChat | null>(null);
  if (holder.current === null || holder.current.scope !== scope) {
    holder.current = switchScopedChat(holder.current, chatUrl, scope, ref);
  }
  return holder.current.chat;
}

/**
 * `useChat` over `/v1/chat` (AI SDK UI message stream, spec S1.1 SD-9).
 *
 * The chat instance is scoped to the `?session=` identity: switching sessions
 * stops the previous stream, recreates the Chat, and the construction-time
 * epoch guard drops any frame that still arrives late — an in-flight stream
 * from the previous session can never mix into the next one. The
 * backend-assigned `session_id` from `data-response` frames is fed back into
 * follow-up requests through the transport's dynamic `headers` function.
 */
function useTrackerReaders(ref: SessionRef) {
  const sessionIdOf = useCallback(() => ref.current.id, [ref]);
  const lastHttpStatus = useCallback(() => ref.current.lastHttpStatus, [ref]);
  const lastErrorCode = useCallback(() => ref.current.lastErrorCode, [ref]);
  const lastQuotaResetsAt = useCallback(() => ref.current.lastQuotaResetsAt, [ref]);
  return { sessionIdOf, lastHttpStatus, lastErrorCode, lastQuotaResetsAt };
}

/** A part-less turn boundary. Without it ai@6.0.225 continues the previous
 * assistant message (`createStreamingUIMessageState` reuses an assistant
 * `lastMessage`) and the same-ID `response` part would overwrite the prior
 * card instead of appending the E1 living-document version. It carries no
 * user utterance — the server must not persist a user row for it (the
 * skip-empty-utterance guard in `persistence.py`, #273 Task 3). */
function recomputeMarker(): ChatUIMessage {
  return { id: `recompute-${generateId()}`, role: "user", parts: [] };
}

type SendHelpers = Pick<UseChatHelpers<ChatUIMessage>, "sendMessage" | "setMessages">;

/**
 * E2 bypass send (issue #273 S1.7): re-submit the conversation with only a
 * `selected_point_ids` body — no new user utterance. ai@6.0.225's
 * `DefaultChatTransport` merges the per-call body (`{...resolvedBody,
 * ...options.body}`), so the field reaches `_optional_ids` unchanged.
 */
function useSendSelectedPoints({ sendMessage, setMessages }: SendHelpers) {
  return useCallback(
    (body: SelectedPointsBody) => {
      setMessages((current) => [...current, recomputeMarker()]);
      void sendMessage(undefined, { body: { ...body } });
    },
    [sendMessage, setMessages],
  );
}

export function useChatSession(chatUrl: string, sessionId?: string) {
  const scope = scopeOf(sessionId);
  const ref = useSessionTracker(sessionId, scope);
  const chat = useScopedChat(chatUrl, scope, ref);
  const helpers = useChat<ChatUIMessage>({ chat });
  return { ...helpers, sendSelectedPoints: useSendSelectedPoints(helpers), ...useTrackerReaders(ref) };
}

export type ChatSession = ReturnType<typeof useChatSession>;
