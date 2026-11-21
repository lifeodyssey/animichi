/**
 * The one conversation id shape the chat surface accepts (#1901): the page
 * mints the id itself before it sends, the POST's `x-session-id` carries it,
 * and the reconnect GET's path names it — all three are the same canonical
 * UUID, so a conversation the POST creates is always one its own reconnect
 * route can read.
 */
const CANONICAL_CONVERSATION_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function canonicalConversationId(id: string): boolean {
  return CANONICAL_CONVERSATION_ID.test(id);
}
