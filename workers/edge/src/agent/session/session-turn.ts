/**
 * One turn, assembled from the Worker environment (card #1252).
 *
 * `AgentSession` owns two things — the requests it answers and the queue its
 * alarm drains — and this owns the third: what a queued run id is actually
 * turned into. They are separate because the assembly is where the deployment's
 * configuration enters (the provider key, the prices, the tools), and none of
 * that has anything to do with routing a request or keeping a queue.
 */
import { withAgentDatabase } from "../../db/agent-database.ts";
import { usagePricesIn } from "../settlement/turn-settlement.ts";
import { catalogToolbox } from "../tools/catalog-toolbox.ts";
import { serviceBindingCatalog, type CatalogBinding } from "../tools/service-binding-catalog.ts";
import { DurableTurn } from "./durable-turn.ts";
import { EnvelopeStagingStore } from "./envelope-staging-store.ts";
import { NeonTurnStore } from "./neon-turn-store.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import { TurnEnvelope } from "./turn-envelope.ts";
import type { TurnCatalogSession } from "./turn-catalog-session.ts";
import { createTurnModels, mimoKeyIn } from "./turn-model.ts";
import type { TurnFrameSink } from "./turn-subscribers.ts";
import { EMPTY_TOOLBOX, type Toolbox } from "./turn-toolbox.ts";
import type { TurnStore } from "./turn-store.ts";

/**
 * The language a turn's rows are rendered in.
 *
 * A placeholder, and marked as one: Python took the locale from the request
 * (`RuntimeDeps.locale`), and nothing in the agent tier carries it yet — no
 * column on `runs` or `messages` holds it, so there is nothing to read. Until
 * a card plumbs it through the intake, every turn localizes city names the way
 * the product's primary audience reads them.
 */
const TURN_LOCALE = "ja";

/** A real wait, injected into the catalog client so its retry backoff is real. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The private `CATALOG` service binding, when the environment carries one. */
function catalogBindingIn(env: Record<string, unknown>): CatalogBinding | undefined {
  const binding = env.CATALOG;
  if (binding !== null && typeof binding === "object" && "fetch" in binding) {
    return binding as CatalogBinding;
  }
  return undefined;
}

/**
 * The tools a turn may call: the four catalog tools over the private binding,
 * bound to this turn's own session state (#1253).
 *
 * A missing binding yields `EMPTY_TOOLBOX` rather than a throw. The gateway
 * tests build envs without one, and a turn that can still answer from the model
 * is a better failure than an alarm that dies before it takes its lease.
 */
export function turnToolbox(env: Record<string, unknown>, session: TurnCatalogSession): Toolbox {
  const binding = catalogBindingIn(env);
  if (binding === undefined) return EMPTY_TOOLBOX;
  const tools = catalogToolbox(serviceBindingCatalog(binding, sleep), session);
  return { tools: () => tools };
}

export interface SessionTurnParts {
  readonly env: Record<string, unknown>;
  readonly emit: TurnFrameSink;
  /** The Durable Object incarnation taking the run's single-writer lease. */
  readonly owner: string;
  /** Where this session's envelope lives between its turns (#1280). */
  readonly envelopes: SessionEnvelopeStore;
  /** Every run this session's alarm still owes work for, in its drain order —
   * what a turn recovers stale stagings from before it reads the envelope. */
  readonly queued: readonly string[];
}

/** The turn one alarm drives, with the deployment's configuration in it. */
function configuredTurn(
  parts: SessionTurnParts,
  store: TurnStore,
  apiKey: string,
  envelope: TurnEnvelope,
): DurableTurn {
  return new DurableTurn({
    store: new EnvelopeStagingStore(store, envelope),
    models: createTurnModels(apiKey),
    toolbox: turnToolbox(parts.env, envelope.session),
    systemPrompt: envelope.systemPrompt,
    prices: usagePricesIn(parts.env),
    emit: parts.emit,
    owner: parts.owner,
    now: Date.now,
  });
}

/**
 * A missing provider key ends the run rather than looping: the sweeper would
 * otherwise re-arm a turn that can never reach a model, forever. It settles
 * without touching the envelope, which is right: no tool ran, so the session
 * knows exactly what it knew before.
 */
async function driveOn(parts: SessionTurnParts, store: TurnStore, runId: string): Promise<void> {
  const apiKey = mimoKeyIn(parts.env);
  if (apiKey === undefined) {
    await store.settleFailed(runId, "provider_failed", new Date());
    return;
  }
  const envelope = await TurnEnvelope.open({
    envelopes: parts.envelopes, runId, queued: parts.queued, locale: TURN_LOCALE,
  });
  await envelope.close(await configuredTurn(parts, store, apiKey, envelope).run(runId));
}

/** Run one queued turn on its own database connection, and close it after. */
export function driveQueuedRun(parts: SessionTurnParts, runId: string): Promise<void> {
  return withAgentDatabase(parts.env, (transactions) =>
    driveOn(parts, new NeonTurnStore(transactions), runId));
}
