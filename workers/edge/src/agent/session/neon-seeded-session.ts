/**
 * The two reads a prefix seeding takes before it writes, in SQL (E-1 #1380).
 *
 * The first is not this module's own: ownership and turn count are what
 * `NeonConversationRecords.factsOf` already answers, in the one statement the
 * retrieval surface reads a session by, so the seeding is held to the same
 * facts a reader is. Re-deriving them here would be a second definition of
 * "whose session is this".
 *
 * The second is the one question no existing read asks. `turnCount` alone
 * cannot tell a re-seeding of the same case from a session somebody has been
 * talking in, and those two need opposite answers — the first is idempotent
 * success, the second is a refusal. `client_message_id` is exactly the column
 * that separates them, because the seeding writes the case id into it.
 *
 * It takes `AgentTransactions` rather than the narrow `AgentStatements` its
 * read-only nature would suggest, because it is composed beside the two WRITING
 * adapters on one connection (`session-prefix.ts`) and they need the wider
 * seam. Each read still opens its own short transaction, which is all a read
 * needs — nothing here decides anything the writes do not re-decide against a
 * database constraint (`messages_session_client_message_id`,
 * `runs_one_running_per_session`).
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentTransactions } from "../../db/agent-database.ts";
import { messages } from "../../db/schema.ts";
import { isJsonRecord } from "../json-record.ts";
import type { ConversationFacts } from "../retrieval/conversation-retrieval.ts";
import { NeonConversationRecords } from "../retrieval/neon-conversation-records.ts";
import type { SeededSessionRecords } from "./prefix-seeding.ts";

/** Whether this session already carries the message a case's prefix is keyed
 * by — the same `(session_id, client_message_id)` pair the intake's partial
 * unique index dedupes on, asked as a question instead of written into. */
function selectPrefixMessage(sessionId: string, clientMessageId: string): SQL {
  return sql`select ${messages.id} as message_id from ${messages}
    where ${messages.sessionId} = ${sessionId}
      and ${messages.clientMessageId} = ${clientMessageId}
    limit 1`;
}

/** The production `SeededSessionRecords`, over the agent data plane. */
export class NeonSeededSession implements SeededSessionRecords {
  readonly #transactions: AgentTransactions;

  constructor(transactions: AgentTransactions) {
    this.#transactions = transactions;
  }

  factsOf(sessionId: string): Promise<ConversationFacts | null> {
    return this.#transactions.run((statements) =>
      new NeonConversationRecords(statements).factsOf(sessionId));
  }

  carriesPrefix(sessionId: string, clientMessageId: string): Promise<boolean> {
    return this.#transactions.run(async (statements) => {
      const found = await statements.execute(selectPrefixMessage(sessionId, clientMessageId));
      return found.rows.some(isJsonRecord);
    });
  }
}
