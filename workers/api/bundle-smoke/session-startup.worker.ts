import { getAgentByName } from "agents";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { NativeOnlyHost } from "./native-only-host.ts";

/** What the probe saw: the domain startups that ran, and which of them bound the domain the agent attached. */
export interface StartupReport {
  readonly startups: number;
  readonly attachedTo: number | null;
}

/** One faux model and a refusing catalog: the probe attaches its session and never drives it. */
function composition(session: Session) {
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  return { models, model: provider.getModel(), toolContext: { session, branch: "main", locale: "en",
    catalog: createCatalogClient(() => Promise.reject(new Error("Unexpected catalog request"))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() } };
}

/** A fresh memory repository holding one closed session, named for the agent. */
async function closedSession(name: string) {
  const repo = new MemorySessionRepo();
  const session = await repo.create({ id: name }, BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
  return { repo, metadata: session.metadata };
}

/**
 * The production host with a counted domain startup. The SDK ran its first start; `restart` runs `onStart` again,
 * as the SDK does after a startup that failed once `onStart` had returned, and only then attaches its session.
 */
export class StartupProbe extends NativeOnlyHost {
  #startups = 0;
  #attachedTo: number | null = null;

  protected override async initializeSession() {
    this.#startups += 1;
    const startup = this.#startups;
    const { repo, metadata } = await closedSession(this.name);
    this.bindProbeSession(repo, metadata, (session) => { this.#attachedTo = startup; return composition(session); });
  }

  /** `this.onStart` is the SDK's own start wrapper around the host's `onStart`, the entry its retry calls. */
  async restart(): Promise<StartupReport> {
    await this.onStart();
    await this.withSession(() => Promise.resolve());
    return { startups: this.#startups, attachedTo: this.#attachedTo };
  }

  /** Bind a second domain onto the started agent, and answer with what the binding throws. */
  async bindAgain(): Promise<string> {
    const { repo, metadata } = await closedSession(this.name);
    try {
      this.bindProbeSession(repo, metadata, composition);
      return "bound";
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return error.message;
    }
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<StartupProbe> }) {
    const path = new URL(request.url).pathname;
    const host = await getAgentByName(env.SESSION, path, { locationHint: "apac" });
    if (path === "/bind-again") return new Response(await host.bindAgain());
    return Response.json(await host.restart());
  },
};
