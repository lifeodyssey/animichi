import { requireOperationTools } from "./operation-tool-settings.ts";
import { nativeClient } from "../../native-client.ts";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import { createCatalogClient } from "@animichi/agent/tools";
import type { Env } from "../../env.ts";
import { nativeHostModels } from "./native-models.ts";
import { requireToolAuthority } from "./native-authority.ts";
import { NATIVE_AGENT_OPTIONS } from "@animichi/agent";
import { edgeKnobs, RUNTIME_KNOBS } from "../../config/edge-vars.ts";

async function readSecret(value: { get(): Promise<string> } | string | undefined) {
  return typeof value === "string" ? value : await value?.get();
}

/** One DO incarnation owns these direct native resources; no module-global socket or alternate store. */
export async function bootstrapNativeSession(env: Env, id: string, context: Context) {
  const url = await readSecret(env.AGENT_SVC_DATABASE_URL);
  if (!url) throw new Error("The native agent database is not configured");
  const db = nativeClient(url);
  try {
    const server = await nativeHostModels(await readSecret(env.MIMO_API_KEY));
    const repo = new NeonSessionRepo(db);
    const row = await db.orm.public.PiSession.where({ id }).first();
    const created = row ? undefined : await repo.create({ id }, context);
    const metadata = created?.metadata ?? row?.metadata as unknown as SessionMetadata;
    await created?.close(context);
    // A resolver, not a captured number: the knob store may change the ceiling
    // while this DO incarnation is alive, so every admission and tool call reads
    // it through the isolate cache instead of the bootstrap value (#688).
    const budgetFor = () => edgeKnobs.read(env, RUNTIME_KNOBS.anonymousDailyCostBudgetUsd);
    const compose = (session: Session) => ({ models: server.models, model: server.model, ...NATIVE_AGENT_OPTIONS,
      toolContext: (toolsContext: Context) => ({ session, branch: "main", ...requireOperationTools(toolsContext),
        catalog: createCatalogClient((request) => env.CATALOG.fetch(request)),
        assertAuthorized: async (operationId: string, toolsContext: Context) => requireToolAuthority(db, id, operationId, await budgetFor(), toolsContext),
        reserveToolUsage: async (_invocationId: string, toolsContext: Context, operationId: string) => requireToolAuthority(db, id, operationId, await budgetFor(), toolsContext) }) });
    return { db, repo, metadata, compose, server, budgetFor };
  } catch (error) { await db.close(); throw error; }
}
export type NativeSessionResources = Awaited<ReturnType<typeof bootstrapNativeSession>>;
