import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useChatEntry } from "./conversation-address";
import { gatedTurnEntry } from "./lib/turn-gate";
import type { ChatSearch } from "./search";
import type { ChatSession } from "./use-chat-session";
import type { ConversationHistory } from "./use-conversation-history";

/**
 * The hero query's conversation identity (#1901). Landing on `/chat?q=`
 * without `?session=`, the page mints the conversation id itself — BEFORE it
 * sends, the pattern of the AI SDK's reference app — and publishes it into the
 * address with `replace`. A remount mid-answer then reads the id back from the
 * address bar and reattaches to the answer still being written, instead of
 * asking again; a reconnect that comes back 404 means the first POST never
 * reached the edge, so the query is resent with the SAME session and turn ids
 * and the edge replays it rather than admitting a second turn.
 */
export interface HeroSession {
  readonly entry: ChatSearch;
  /** The page minted the id: this mount owns the first send. */
  readonly minted: boolean;
}

function heroSessionOf(search: ChatSearch): HeroSession {
  if (search.session !== undefined || !search.q) return { entry: search, minted: false };
  return { entry: { ...search, session: crypto.randomUUID() }, minted: true };
}

/** The frozen chat entry, with the hero session minted into it on a fresh `?q=` landing. */
export function useHeroSession(search: ChatSearch): HeroSession {
  const frozen = useChatEntry(search);
  const ref = useRef<HeroSession | undefined>(undefined);
  ref.current ??= heroSessionOf(frozen);
  return ref.current;
}

/** The address carries `?session=` from the moment the query is sent. */
export function usePublishMintedSession(hero: HeroSession): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!hero.minted) return;
    void navigate({ to: "/chat", search: (current) => ({ ...current, session: hero.entry.session }), replace: true });
  }, [hero, navigate]);
}

/** The hero turn's message id: stable across mounts, so its `x-turn-id` is too. */
function heroMessageId(sessionId: string | undefined): string | undefined {
  return sessionId === undefined ? undefined : `hero-${sessionId}`;
}

/** The hero send: the shared status gate, stamped with the stable hero message id.
 * AI SDK 7.x (verified at 7.0.105) drops `id` from a `{ text }` shorthand, so
 * the hero message goes out as a full object — its id is the `x-turn-id` source. */
export function useHeroSend(chat: ChatSession, hero: HeroSession): (text: string) => void {
  const { sendMessage, status } = chat;
  const sessionId = hero.entry.session;
  return useMemo(() => gatedTurnEntry(status, (text: string) => {
    void sendMessage({ id: heroMessageId(sessionId), role: "user", parts: [{ type: "text", text }] });
  }), [sendMessage, status, sessionId]);
}

/** The query to resend when the reconnect came back 404, else nothing. The
 * legitimate reconnect-404 leaves the chat EMPTY: a 404 from a later turn —
 * after a successful reconnect streamed its answer in — is that turn's own
 * failure, never a cue to ask the hero query again. */
function heroResendQuery(hero: HeroSession, chat: ChatSession): string | undefined {
  if (hero.minted || !hero.entry.q) return undefined;
  if (chat.messages.length > 0) return undefined;
  if (chat.status !== "error" || chat.lastHttpStatus() !== 404) return undefined;
  return hero.entry.q;
}

/** The 404 resend: once per mount, behind the same health gate as the first send. */
export function useHeroResend(hero: HeroSession, chat: ChatSession, healthy: boolean, send: (text: string) => void): void {
  const resent = useRef(false);
  useEffect(() => {
    const query = heroResendQuery(hero, chat);
    if (resent.current || !healthy || query === undefined) return;
    resent.current = true;
    chat.clearError();
    send(query);
  }, [hero, chat, healthy, send]);
}

/** The remount whose first POST never landed gets a 404 from history as well,
 * and the resend clears only the chat error. Once the resent turn has settled
 * the session exists, so pull history in: the A3 gate unlocks and the notice
 * clears. Once per mount — a resumed session with a genuine 404 and no resend
 * keeps its empty chat, so its error stays honest. */
export function useHeroHistoryRefetch(hero: HeroSession, chat: ChatSession, history: ConversationHistory): void {
  const refetched = useRef(false);
  useEffect(() => {
    if (refetched.current || hero.minted || history.status !== "error") return;
    if (chat.status !== "ready" || chat.messages.length === 0) return;
    refetched.current = true;
    history.retry();
  }, [hero, chat, history]);
}
