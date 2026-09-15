import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import type { Env } from "../env.ts";
import { listConversations } from "../agent/views/conversation-list.ts";

/**
 * `GET /v1/conversations` on the native tier: the caller's own conversation
 * index, read straight from Neon with the identity the gateway verified.
 *
 * The identity ladder is the whole authorization (see `agent-tier-route.ts`);
 * by the time this adapter runs there is no anonymous caller to serve, which
 * is why an unauthenticated list is a 401 that never opens this database.
 * `no-store` because the body is one user's list and no cache may keep it.
 */
export async function nativeConversationListResponse(env: Env, identityId: string): Promise<Response> {
  const binding = env.AGENT_SVC_DATABASE_URL;
  const url = typeof binding === "string" ? binding : await binding?.get();
  if (!url) throw new Error("The native agent database is not configured");
  const db = postgres<Contract>({ contractJson, url });
  try {
    return Response.json(await listConversations(db, identityId), { headers: { "cache-control": "no-store" } });
  } finally { await db.close(); }
}
