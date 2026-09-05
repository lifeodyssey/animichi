import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { assignedSessionIdIn } from "./data-parts";
import type { ChatSearch } from "./search";
import type { ChatUIMessage } from "./use-chat-session";

/**
 * The conversation's two-way relationship with the address bar (issue #1337).
 *
 * Reading is an ENTRY act: `?q=`, `?session=` and `?route=` name the
 * conversation to open, and the page reads them exactly once — when it mounts.
 * Writing is what happens afterwards: the id the backend assigns to a fresh
 * draft is published back into the address bar, which is what lets a trip to
 * `/settings`, a shared link or a reload resume THIS conversation instead of
 * opening a draft. `replace` keeps Back leaving the chat rather than stepping
 * through session ids.
 *
 * The two directions must never meet. Re-reading a published id as an entry
 * would change `use-chat-session`'s scope mid-turn — a new `Chat`, a stopped
 * stream and an A3 history refetch — discarding the very conversation this
 * exists to keep.
 */
export function useChatEntry(search: ChatSearch): ChatSearch {
  return useRef(search).current;
}

function assignedIn(message: ChatUIMessage): string | undefined {
  for (const part of message.parts) {
    if (part.type !== "data-response") continue;
    const assigned = assignedSessionIdIn(part.data);
    if (assigned !== undefined) return assigned;
  }
  return undefined;
}

/**
 * The session id the backend assigned, read off the streamed frames rather
 * than `useChatSession`'s tracker ref: the ref deliberately does not
 * re-render, and publishing an address needs a rendered value.
 */
export function assignedSessionId(messages: readonly ChatUIMessage[]): string | undefined {
  for (const message of messages) {
    const assigned = assignedIn(message);
    if (assigned !== undefined) return assigned;
  }
  return undefined;
}

/** Publish the assigned id into `/chat?session=`, once it differs from the entry. */
export function usePublishSessionId(entry: ChatSearch, assigned: string | undefined): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (assigned === undefined || assigned === entry.session) return;
    void navigate({ to: "/chat", search: (current) => ({ ...current, session: assigned }), replace: true });
  }, [assigned, entry.session, navigate]);
}
