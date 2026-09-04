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
import type { ByokCredential } from "../byok/byok-credential.ts";
import { byokTurnModel } from "../byok/byok-turn-model.ts";
import { usagePricesIn } from "../settlement/turn-settlement.ts";
import { webSearchFetch } from "../egress/web-search-egress.ts";
import { agentToolbox } from "../tools/agent-toolbox.ts";
import type { CatalogClient } from "../tools/catalog-client.ts";
import { duckduckgoWebSearcher } from "../tools/duckduckgo-web-searcher.ts";
import { toollessCompletion, type ModelStream } from "../tools/model-title-translation.ts";
import { serviceBindingCatalog, type CatalogBinding } from "../tools/service-binding-catalog.ts";
import { titleTranslator, type TitleTranslator } from "../tools/title-translation.ts";
import { DurableTurn } from "./durable-turn.ts";
import { EnvelopeStagingStore } from "./envelope-staging-store.ts";
import { NeonTurnStore } from "./neon-turn-store.ts";
import { TurnAnswering } from "./turn-answer.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import { TurnEnvelope } from "./turn-envelope.ts";
import type { TurnCatalogSession } from "./turn-catalog-session.ts";
import { mimoKeyIn, mimoTurnModel, streamOptionsFor, type TurnModel } from "./turn-model.ts";
import { scrubbedFrames, type TurnFrameSink } from "./turn-subscribers.ts";
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
 * The turn's own model, streamed tool-less, behind the translation's port.
 *
 * "The turn's own" is load-bearing since #1289: on a BYOK turn this is the
 * CALLER-KEYED registry, so `translate_anime_title`'s fallback completion
 * spends the caller's key and leaves through `GuardedFetch` — same as every
 * other call of that turn. Looking mimo up by name here instead would both
 * throw (a BYOK registry has no mimo provider) and, if it did not, bill the
 * platform for a turn the caller paid for. `streamOptionsFor` is the one place
 * the guarded fetch is attached, shared with `turn-agent.ts`.
 */
function turnTranslator(catalog: CatalogClient, turn: TurnModel): TitleTranslator {
  const stream: ModelStream = (model, context, options) =>
    turn.registry.streamSimple(model, context, streamOptionsFor(turn, options));
  return titleTranslator(catalog, toollessCompletion(turn.model, stream));
}

/**
 * The tools a turn may call: the four catalog tools over the private binding,
 * plus the two web tools (#1287), bound to this turn's own session state.
 *
 * A missing binding yields `EMPTY_TOOLBOX` rather than a throw. The gateway
 * tests build envs without one, and a turn that can still answer from the model
 * is a better failure than an alarm that dies before it takes its lease. The
 * web tools go with them rather than being offered alone: `translate_anime_title`
 * needs the same catalog, and a turn holding half a toolbox is a shape nothing
 * in the prompt describes.
 *
 * `model` is here for one reason — `translate_anime_title`'s fallback path is
 * a tool-less call on the TURN's own model, exactly as Python's translation
 * sub-agent inherited `ctx.model`. It is the whole `TurnModel` rather than a
 * bare registry because that fallback must also carry the turn's egress guard
 * (#1289), which lives on the same value.
 */
export function turnToolbox(
  env: Record<string, unknown>,
  session: TurnCatalogSession,
  model: TurnModel,
): Toolbox {
  const binding = catalogBindingIn(env);
  if (binding === undefined) return EMPTY_TOOLBOX;
  const catalog = serviceBindingCatalog(binding, sleep);
  const search = duckduckgoWebSearcher(webSearchFetch());
  const tools = agentToolbox({ catalog, session, search, translate: turnTranslator(catalog, model) });
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
  /** The caller's own key for THIS run, straight out of the incarnation's heap
   * (#1289). Absent = the deployment's own model. */
  readonly byok?: ByokCredential;
}

/**
 * WHICH MODEL THIS TURN RUNS ON, and the one branch spec §四 S5 forbids: a
 * turn that arrived with a caller's credential runs on it or not at all. There
 * is no `??` here on purpose — `byokTurnModel` never consults the environment,
 * so the server key is not merely unpreferred for a BYOK turn, it is out of
 * scope. `null` means no model at all, which the caller settles as a failure.
 */
export function turnModelFor(
  env: Record<string, unknown>, byok: ByokCredential | undefined,
): TurnModel | null {
  if (byok !== undefined) return byokTurnModel(byok);
  const apiKey = mimoKeyIn(env);
  return apiKey === undefined ? null : mimoTurnModel(apiKey);
}

/** A BYOK turn's frames go out through its own secret's scrub; a plain turn's
 * go out exactly as W1 measured them. */
export function turnFrameSink(emit: TurnFrameSink, model: TurnModel): TurnFrameSink {
  const { scrub } = model;
  return scrub === undefined ? emit : scrubbedFrames(emit, scrub);
}

/** The turn one alarm drives, with the deployment's configuration in it. */
function configuredTurn(
  parts: SessionTurnParts,
  store: TurnStore,
  model: TurnModel,
  envelope: TurnEnvelope,
): DurableTurn {
  return new DurableTurn({
    store: new EnvelopeStagingStore(store, envelope),
    model,
    toolbox: turnToolbox(parts.env, envelope.session, model),
    answering: new TurnAnswering(envelope.session),
    systemPrompt: envelope.systemPrompt,
    prices: usagePricesIn(parts.env),
    emit: turnFrameSink(parts.emit, model),
    owner: parts.owner,
    now: Date.now,
  });
}

/**
 * A turn with no model at all ends the run rather than looping: the sweeper
 * would otherwise re-arm a turn that can never reach a provider, forever. It
 * settles without touching the envelope, which is right: no tool ran, so the
 * session knows exactly what it knew before.
 */
async function driveOn(parts: SessionTurnParts, store: TurnStore, runId: string): Promise<void> {
  const model = turnModelFor(parts.env, parts.byok);
  if (model === null) {
    await store.settleFailed(runId, "provider_failed", new Date());
    return;
  }
  const envelope = await TurnEnvelope.open({
    envelopes: parts.envelopes, runId, queued: parts.queued, locale: TURN_LOCALE,
  });
  await envelope.close(await configuredTurn(parts, store, model, envelope).run(runId));
}

/** Run one queued turn on its own database connection, and close it after. */
export function driveQueuedRun(parts: SessionTurnParts, runId: string): Promise<void> {
  return withAgentDatabase(parts.env, (transactions) =>
    driveOn(parts, new NeonTurnStore(transactions), runId));
}
