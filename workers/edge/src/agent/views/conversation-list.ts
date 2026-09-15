import type { ConversationListRow } from "@animichi/contract/session-history-contract";
import type { AdmissionDatabase } from "../admission/types.ts";

/** The container's own cap, kept verbatim (Card E of the #1317 decomposition):
 * the sidebar's RECENT section has never asked for a window of its own. */
const CONVERSATION_LIST_LIMIT = 30;

/** The row this statement declares: the contract's own `ConversationListRow`,
 * so this query and the declared body cannot drift apart without a compile
 * error. Timestamps travel as the driver's own text, and every column but the
 * id is nullable in the table. */
const CONVERSATION_LIST_ROW = {
  session_id: { codecId: "pg/text@1" },
  title: { codecId: "pg/text@1", nullable: true },
  first_query: { codecId: "pg/text@1", nullable: true },
  created_at: { codecId: "pg/timestamptz-string@1", nullable: true },
  updated_at: { codecId: "pg/timestamptz-string@1", nullable: true },
} as const;

/** The one statement behind the list: the caller's own rows, newest first,
 * capped at 30. */
function conversationListStatement(db: AdmissionDatabase, identityId: string) {
  return db.raw.sql`SELECT id AS session_id, title, first_query, created_at, updated_at
    FROM sessions WHERE user_id = ${identityId} ORDER BY updated_at DESC LIMIT ${CONVERSATION_LIST_LIMIT}`
    .returnsRow(CONVERSATION_LIST_ROW).build();
}

/**
 * The caller's own conversations, newest first — the read behind
 * `GET /v1/conversations`, which moved from the container to this Worker.
 *
 * The statement is scoped to `sessions.user_id` and never to anything the
 * caller supplied: that predicate is what makes the route safe, not the route
 * table. The order and the cap are the semantics the container's
 * `list_sessions` had.
 */
export async function listConversations(db: AdmissionDatabase, identityId: string): Promise<ConversationListRow[]> {
  return await db.runtime().query(conversationListStatement(db, identityId));
}
