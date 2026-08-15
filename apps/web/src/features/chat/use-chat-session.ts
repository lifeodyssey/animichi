import { Chat, useChat } from "@ai-sdk/react";
import type { UseChatHelpers } from "@ai-sdk/react";
import { AnonLimitErrorEnvelope, ChatResponseDataPart, readQuotaResetsAt } from "@animichi/contract";
import type { ChatDataPart } from "@animichi/contract";
import { DefaultChatTransport, generateId } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { z } from "zod";
import type { SelectedPointsBody } from "./selection/use-recompute-turn";
import { sessionHeaders } from "./session-headers";
import type { SessionOffer } from "./session-headers";

/**
 * Typed UI message: the `data-response` part carries the contract envelope,
 * so streamed frames are schema-validated by the AI SDK before they can
 * overwrite an existing same-ID part (`dataPartSchemas`).
 */
export type ChatUIMessage = UIMessage<unknown, { response: ChatDataPart }>;

// AI SDK 7.x (verified at 7.0.47) looks the schema up by the stripped name
// ("response") when validating whole messages but by the full chunk type ("data-response")
// while streaming, so the schema is registered under both keys.
const dataPartSchemas = {
  response: ChatResponseDataPart,
  "data-response": ChatResponseDataPart,
};

interface SessionTracker {
  scope: string;
  id: string | undefined;
  /** TURN-4 #955: the Session offer echoed by the server — the CAS revision
   * and the digest of the persisted session envelope. Sent back as
   * `x-session-revision` / `x-session-digest` on the next turn. */
  revision: number | undefined;
  digest: string | undefined;
  /** Issue #1014 AC6: the idempotency key minted once per logical turn and
   * reused across a retried send, so a stream-interrupted retry carries the
   * SAME x-turn-id and the server dedups it instead of charging a rerun. */
  pendingTurnId: string | undefined;
  lastHttpStatus: number | undefined;
  lastErrorCode: string | undefined;
  /** D12's `quota_resets_at`: when this identity's allowance returns. */
  lastQuotaResetsAt: string | undefined;
}
type SessionRef = RefObject<SessionTracker>;

function emptyTracker(scope: string, sessionId: string | undefined): SessionTracker {
  return { scope, id: sessionId, pendingTurnId: undefined, ...blankOffer(), ...blankRejection() };
}

function blankOffer(): { revision: undefined; digest: undefined } {
  return { revision: undefined, digest: undefined };
}

function blankRejection(): { lastHttpStatus: undefined; lastErrorCode: undefined; lastQuotaResetsAt: undefined } {
  return { lastHttpStatus: undefined, lastErrorCode: undefined, lastQuotaResetsAt: undefined };
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

function captureSessionOffer(ref: SessionRef, part: Readonly<{ data: ChatDataPart }>): void {
  const { session_id, revision, session_digest } = part.data;
  if (typeof session_id === "string" && session_id !== "") ref.current.id = session_id;
  if (typeof revision === "number") ref.current.revision = revision;
  if (typeof session_digest === "string" && session_digest !== "") ref.current.digest = session_digest;
}

/** The Session offer to echo on the next turn (TURN-4 #955). */
function offerOf(ref: SessionRef): SessionOffer {
  return { sessionId: ref.current.id, revision: ref.current.revision, digest: ref.current.digest };
}

/**
 * Mint (or reuse) the idempotency key for the current logical turn (AC6).
 * The first header call of a send pins `pendingTurnId`; a retry of the same
 * send (e.g. after a mid-stream disconnect) returns the SAME id so the server
 * dedups it. A genuinely new send gets a fresh id once the previous turn ends.
 */
function nextTurnId(ref: SessionRef): string {
  ref.current.pendingTurnId ??= generateId();
  return ref.current.pendingTurnId;
}

/** Clear the per-turn idempotency key once a turn genuinely completes. */
function endTurn(ref: SessionRef): void {
  ref.current.pendingTurnId = undefined;
}

/** The AI SDK finish signal; a turn completes only absent all of these. */
interface FinishInfo {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
}

/** AC6: free the per-turn idempotency key only on genuine completion so a
 * disconnected/aborted/errored turn's retry keeps the SAME x-turn-id. */
function handleFinish(ref: SessionRef, finish: FinishInfo): void {
  if (finish.isAbort || finish.isDisconnect || finish.isError) return;
  endTurn(ref);
}

/** Handlers pinned to their scope epoch so a late frame from a previous
 * scope's stream cannot fire the current callback. */
function chatHandlers(scope: string, ref: SessionRef) {
  return {
    onData: (part: { data: ChatDataPart }) => {
      if (ref.current.scope === scope) captureSessionOffer(ref, part);
    },
    onFinish: (finish: FinishInfo) => {
      handleFinish(ref, finish);
    },
  };
}

function createScopedChat(chatUrl: string, scope: string, ref: SessionRef): Chat<ChatUIMessage> {
  return new Chat<ChatUIMessage>({
    id: scope,
    transport: createSessionTransport(chatUrl, ref),
    dataPartSchemas,
    ...chatHandlers(scope, ref),
  });
}

/** The rejection envelope's shape, as far as classification needs it. */
interface RejectionDetail {
  readonly code: string | undefined;
  readonly quotaResetsAt: string | undefined;
}

const NO_REJECTION: RejectionDetail = { code: undefined, quotaResetsAt: undefined };

const RejectionCodeEnvelope = z.object({ error: z.object({ code: z.string() }) });

/**
 * Read the rejection's error code — which separates D8 (401/403 expiry) from
 * D11 (`anon_budget_exhausted`) and D12 (`anon_quota_exhausted`) — plus D12's
 * `quota_resets_at`, read through the shared contract. Only failures are
 * parsed; a streaming 2xx body is never touched, let alone buffered.
 */
async function readRejection(response: Response): Promise<RejectionDetail> {
  if (response.ok) return NO_REJECTION;
  const body: unknown = await response.clone().json().catch(() => undefined);
  const limit = AnonLimitErrorEnvelope.safeParse(body);
  const rejection = RejectionCodeEnvelope.safeParse(body);
  const code = limit.success ? limit.data.error.code : rejection.data?.error.code;
  return { code, quotaResetsAt: readQuotaResetsAt(body) };
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
    headers: () => sessionHeaders({ ...offerOf(ref), turnId: nextTurnId(ref) }),
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
  const sessionOfferOf = useCallback(() => offerOf(ref), [ref]);
  const lastHttpStatus = useCallback(() => ref.current.lastHttpStatus, [ref]);
  const lastErrorCode = useCallback(() => ref.current.lastErrorCode, [ref]);
  const lastQuotaResetsAt = useCallback(() => ref.current.lastQuotaResetsAt, [ref]);
  return { sessionIdOf, sessionOfferOf, lastHttpStatus, lastErrorCode, lastQuotaResetsAt };
}

/** A part-less turn boundary. Without the marker, AI SDK 7.x (verified at 7.0.47) continues the
 * previous assistant message (`createStreamingUIMessageState` reuses an assistant
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
 * `selected_point_ids` body — no new user utterance. AI SDK 7.x (verified at 7.0.47)'s
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
  return useChatSessionHelpers(chat, ref);
}

function useChatSessionHelpers(chat: Chat<ChatUIMessage>, ref: SessionRef) {
  const helpers = useChat<ChatUIMessage>({ chat });
  return {
    ...helpers,
    sendSelectedPoints: useSendSelectedPoints(helpers),
    ...useTrackerReaders(ref),
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
