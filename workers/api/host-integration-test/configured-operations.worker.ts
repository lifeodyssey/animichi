import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, type Models, type Provider } from "@earendil-works/pi-ai";
import type { Env } from "../src/env.ts";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import type { SessionDomain } from "../src/agent/host/session-domain.ts";
import defaultHost from "./default-host.worker.ts";

/** What the session's models hold for one provider: whether it is still registered, and the key it would authenticate with. */
export interface ProviderHold { registered: boolean; key: string | null }

/** One incarnation's drives, and what its models held for the last drive's provider, when that drive began and now. */
export interface DriveReport { drives: number; served: { provider: string; atDrive: ProviderHold; now: ProviderHold } | null }

const NO_AMBIENT_AUTH = { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) };

/** The key a provider would authenticate with now: its own auth, resolved from a registry that holds nothing else. */
async function keyOf(provider: Provider) {
  const probe = createModels({ authContext: NO_AMBIENT_AUTH });
  probe.setProvider(provider);
  return (await probe.getAuth(provider.id))?.auth.apiKey ?? null;
}

/** The deployed class on its production bootstrap, observed around each drive; ConfiguredOperations performs every operation. */
export class AgentSession extends SessionAgent {
  #models?: Models;
  #drives = 0;
  #served?: { provider: Provider; atDrive: ProviderHold };

  /** Keeps the session's models: the registry an operation's BYOK provider joins at admission and leaves at release. */
  protected override bindSession(domain: SessionDomain) {
    super.bindSession({ ...domain, compose: (session) => {
      const options = domain.compose(session);
      this.#models = options.models;
      return options;
    } });
  }

  protected override async driveLane(lane: AgentLane, operationId: string, context: Context) {
    this.#drives += 1;
    const model = await lane.getModel(context);
    const provider = model && this.#models?.getProvider(model.provider);
    this.#served = provider && { provider, atDrive: await this.#hold(provider) };
    return super.driveLane(lane, operationId, context);
  }

  /** Queued behind every wake already running, so a settlement's release has finished before this reads. */
  driveReport(): Promise<DriveReport> {
    return this.withSession(async () => ({ drives: this.#drives, served: await this.#servedNow() }));
  }

  async #servedNow() {
    const served = this.#served;
    return served ? { provider: served.provider.id, atDrive: served.atDrive, now: await this.#hold(served.provider) } : null;
  }

  async #hold(provider: Provider): Promise<ProviderHold> {
    return { registered: this.#models?.getProvider(provider.id) === provider, key: await keyOf(provider) };
  }
}

interface ObservedEnv extends Env { readonly AGENT_SESSION: DurableObjectNamespace<AgentSession> }

/** The observed session a test route names in `x-session-id`, the header every chat request already carries. */
function observedSession(request: Request, env: ObservedEnv) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) throw new Error("A test route names its session in x-session-id");
  return sessionAgentStub(env.AGENT_SESSION, sessionId);
}

/** The default host's routes, plus one recovery wake run to completion and the drive report. */
export default {
  async fetch(request: Request, env: ObservedEnv) {
    const path = new URL(request.url).pathname;
    if (path !== "/wake" && path !== "/drive-report") return defaultHost.fetch(request, env);
    const host = await observedSession(request, env);
    if (path === "/drive-report") return Response.json(await host.driveReport());
    await host.wakeSession();
    return new Response("woken");
  },
};
