/**
 * Composer-draft persistence (issue #282 S1.10).
 *
 * The D12 quota copy promises the visitor's half-typed message survives
 * signing in — but the magic-link round-trip is a full document load, which
 * takes component state with it. Session storage is the smallest thing that
 * keeps that promise honest: same tab, cleared when the tab closes, never sent
 * anywhere.
 *
 * It lives behind this module for the same reason `byokStorage.ts` exists:
 * components do not touch the storage API directly, so quota-exempt access is
 * reviewable in one place and the source guard stays meaningful. Unlike BYOK
 * this holds no secret — only what the visitor already typed on screen.
 */

/** The tab-local key the composer draft is parked under. */
export const CHAT_DRAFT_KEY = "animichi:chat-draft";

/** Private-mode Safari throws on access rather than returning null. */
function draftStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readChatDraft(): string {
  return draftStore()?.getItem(CHAT_DRAFT_KEY) ?? "";
}

export function writeChatDraft(text: string): void {
  const store = draftStore();
  if (text === "") store?.removeItem(CHAT_DRAFT_KEY);
  else store?.setItem(CHAT_DRAFT_KEY, text);
}
