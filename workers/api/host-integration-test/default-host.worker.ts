import { neonAgentTurnTier } from "../src/gateway/agent-turn.ts";
import type { Env } from "../src/env.ts";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { recoveryScanInterval } from "./wake-cadence.ts";

/**
 * The deployed class, whose recurring recovery cadence a case may shorten (issue #1731).
 *
 * Bootstrap, Prisma/Neon resources, models, tools and routing stay exactly the production
 * defaults, and so does the cadence unless the case passes `FAST_RECOVERY_SCAN`.
 */
export class AgentSession extends SessionAgent {
  protected override wakeIntervalMs() { return recoveryScanInterval(this.env, super.wakeIntervalMs()); }
}

const tier = neonAgentTurnTier();

/** Test boundary supplies an already verified gateway identity, never native resources or business handlers. */
export default { fetch(request: Request, env: Env) {
  const identity = { userId: String(env.TEST_IDENTITY), userType: String(env.TEST_USER_TYPE) };
  const sessionId = new URL(request.url).pathname.split("/")[3];
  if (request.method === "GET" && sessionId && new URL(request.url).pathname.endsWith("/stream")) return tier.stream(env, request, identity, sessionId);
  if (request.method === "GET" && sessionId) return tier.transcript(env, request, identity, sessionId);
  return tier.chat(env, request, identity);
} };
