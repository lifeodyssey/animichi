import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Where a login opened from inside the chat should land (issue #507 review).
 *
 * Wiring `/v1/session/migrate` re-points the anonymous sessions onto the
 * account, but that is only half a fix: `/chat?session=<id>` is the **only**
 * entry in the app that reads a migrated session back — there is no session or
 * route list — and none of the three in-chat login walls carried a return
 * target. `sanitizeReturnTarget(undefined)` is `/`, so every one of them
 * migrated the work correctly and then dropped the visitor on the landing page
 * with no way back to it.
 *
 * The live session id cannot come from the URL: `?session=` is an *entry*
 * parameter, and the id the backend assigns mid-conversation is never written
 * back to the address bar (`ChatPage` does not navigate). It lives only in
 * `useChatSession`'s tracker ref, which is why it is published through context
 * rather than read off `location` — and through the reader function rather than
 * the value, since the ref deliberately does not re-render on change.
 */
export const CHAT_SESSION_PARAM = "session";

type SessionIdReader = () => string | undefined;

const ChatSessionIdContext = createContext<SessionIdReader>(() => undefined);

/** `/chat?session=<id>`, or nothing when no session exists to return to. */
export function chatSessionTarget(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || sessionId === "") return undefined;
  return `/chat?${CHAT_SESSION_PARAM}=${encodeURIComponent(sessionId)}`;
}

interface ProviderProps {
  readonly sessionIdOf: SessionIdReader;
  readonly children: ReactNode;
}

export function ChatReturnTargetProvider({ sessionIdOf, children }: ProviderProps) {
  return <ChatSessionIdContext value={sessionIdOf}>{children}</ChatSessionIdContext>;
}

/**
 * The return target for a login wall rendered inside the chat. `undefined`
 * outside a chat (the landing-page modal), which keeps today's `/` behaviour.
 */
export function useChatReturnTarget(): string | undefined {
  return chatSessionTarget(useContext(ChatSessionIdContext)());
}

/**
 * Did the login that produced this callback come from a browser that had a
 * chat session? Read back off the callback's own `next`, which is the only
 * carrier that survives the magic link into a different tab — or a different
 * device, which is exactly the case this exists to catch (#507 review P1-2):
 * there the target still names a session while the `aid` cookie is absent, so
 * the migration correctly moves nothing and the mismatch is the signal.
 */
export function returnTargetNamesSession(next: string | undefined): boolean {
  if (next === undefined) return false;
  const query = next.slice(next.indexOf("?") + 1);
  return next.includes("?") && new URLSearchParams(query).has(CHAT_SESSION_PARAM);
}
