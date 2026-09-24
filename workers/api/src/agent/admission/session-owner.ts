import type { AdmissionDatabase, AdmissionTransaction, ModelAdmissionRequest } from "./types.ts";

/** Read authorization never claims a missing conversation or locks its writer. */
export async function ownsConversation(db: AdmissionDatabase, sessionId: string, identityId: string) {
  const rows = await db.runtime().query(db.raw.sql`SELECT user_id AS owner FROM sessions WHERE id = ${sessionId}`
    .returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build());
  return rows[0]?.owner === identityId;
}

/** Only a new request intent may create its conversation owner row. */
export async function createOrLockOwnedConversation(
  db: AdmissionDatabase, tx: AdmissionTransaction, request: Pick<ModelAdmissionRequest, "sessionId" | "identityId" | "text">,
) {
  const plan = db.raw.sql`INSERT INTO sessions (id, user_id, first_query) VALUES (${request.sessionId}, ${request.identityId}, ${request.text})
    ON CONFLICT (id) DO UPDATE SET user_id = sessions.user_id
    RETURNING user_id AS owner`.returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build();
  const rows = await tx.query(plan);
  return rows[0]?.owner === request.identityId;
}

/** Fill the read-side title only after a successful first model response. */
export async function setDefaultConversationTitle(db: AdmissionDatabase, tx: AdmissionTransaction, sessionId: string) {
  await tx.execute(db.raw.sql`UPDATE sessions SET title = LEFT(first_query, 20)
    WHERE id = ${sessionId} AND title IS NULL AND first_query IS NOT NULL`.affectedCount().build());
}

/** Recovery and reservation must not resurrect a conversation the user deleted. */
export async function lockOwnedConversation(
  db: AdmissionDatabase, tx: AdmissionTransaction, request: Pick<ModelAdmissionRequest, "sessionId" | "identityId">,
) {
  const plan = db.raw.sql`SELECT user_id AS owner FROM sessions
    WHERE id = ${request.sessionId} FOR UPDATE`.returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build();
  const rows = await tx.query(plan);
  return rows[0]?.owner === request.identityId;
}
