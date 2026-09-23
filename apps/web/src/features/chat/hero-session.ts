import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useChatEntry } from "./conversation-address";
import { gatedTurnEntry } from "./lib/turn-gate";
import type { ChatSearch } from "./search";
import type { ChatSession } from "./use-chat-session";

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

function heroReconnectLost(hero: HeroSession, chat: ChatSession): boolean {
  if (hero.minted || !hero.entry.q) return false;
  return chat.status === "error" && chat.lastHttpStatus() === 404;
}

/** The 404 resend: once per mount, behind the same health gate as the first send. */
export function useHeroResend(hero: HeroSession, chat: ChatSession, healthy: boolean, send: (text: string) => void): void {
  const resent = useRef(false);
  useEffect(() => {
    if (resent.current || !healthy || !heroReconnectLost(hero, chat)) return;
    resent.current = true;
    chat.clearError();
    send(hero.entry.q ?? "");
  }, [hero, chat, healthy, send]);
}
