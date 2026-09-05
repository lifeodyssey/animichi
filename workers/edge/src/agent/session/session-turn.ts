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
import { SupplementalUsage } from "../settlement/supplemental-usage.ts";
import { usagePricesIn } from "../settlement/turn-settlement.ts";
import { webSearchFetch } from "../egress/web-search-egress.ts";
import { answerSelection } from "../selection/turn-selection.ts";
import { agentToolbox } from "../tools/agent-toolbox.ts";
import type { CatalogClient } from "../tools/catalog-client.ts";
import { duckduckgoWebSearcher } from "../tools/duckduckgo-web-searcher.ts";
import { toollessCompletion, type ModelStream } from "../tools/model-title-translation.ts";
import { serviceBindingCatalog, type CatalogBinding } from "../tools/service-binding-catalog.ts";
import { titleTranslator, type TitleTranslator } from "../tools/title-translation.ts";
import { DurableTurn } from "./durable-turn.ts";
import type { SelectionTurn } from "./turn-attempt.ts";
import { EnvelopeStagingStore } from "./envelope-staging-store.ts";
import { NeonTurnStore } from "./neon-turn-store.ts";
import { TurnAnswering } from "./turn-answer.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import { TurnEnvelope } from "./turn-envelope.ts";
import type { TurnCatalogSession } from "./turn-catalog-session.ts";
import {
  guardedMimoTurnModel,
  mimoKeyIn,
  mimoTurnModel,
  streamOptionsFor,
  type TurnModel,
} from "./turn-model.ts";
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

/** The catalog every turn of this deployment calls, when the binding is there. */
function turnCatalog(env: Record<string, unknown>): CatalogClient | undefined {
  const binding = catalogBindingIn(env);
  return binding === undefined ? undefined : serviceBindingCatalog(binding, sleep);
}

/**
 * How a DETERMINISTIC selection turn answers itself (#1288), or null when this
 * deployment has no catalog to ask. Assembled here for the reason everything
 * else in this file is: the binding is deployment configuration, and neither
 * the loop nor `src/agent/selection/` should have to know how to find one.
 */
export function turnSelection(
  env: Record<string, unknown>,
  session: TurnCatalogSession,
  emit: TurnFrameSink,
): SelectionTurn | null {
  const catalog = turnCatalog(env);
  if (catalog === undefined) return null;
  return (request, steps) => answerSelection({ catalog, session, steps, emit }, request);
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
 * WHICH MODEL TRANSLATES — Python's D18, wired (#1289).
 *
 * A plain turn translates on its own model, which is the server's: one
 * registry, one connection, exactly as `RunContext.model` was inherited. A
 * CALLER-KEYED turn does not. `public_api.py:922`'s `_server_title_translator`
 * exists to force this tool onto the server key on a BYOK turn — "without this
 * override the tool inherits the active run's own model … which on a BYOK turn
 * *is* the caller's credential" — and it books what it spends as `platform`.
 * `title-translation.ts`'s own header states the same rule. So the caller's key
 * pays for the turn they asked for, and the platform pays for a translation
 * they did not.
 *
 * `null` when a caller-keyed turn has no server key to fall back to: the chain
 * then answers `untranslated`, which is the honest degradation. Reaching for
 * the caller's key there would be the exact fallback this function exists to
 * prevent.
 */
export function translationModel(env: Record<string, unknown>, turn: TurnModel): TurnModel | null {
  if (!turn.callerKeyed) return turn;
  const serverKey = mimoKeyIn(env);
  return serverKey === undefined ? null : guardedMimoTurnModel(serverKey);
}

/** The translation's tool-less completion, on whichever model D18 allows it,
 * reporting its tokens to `spent` (#1292) because no `message_end` of that call
 * ever reaches the loop. `streamOptionsFor` is the one place a guarded fetch is
 * attached, shared with `turn-agent.ts`, so this hop cannot quietly become the
 * unguarded one. */
function turnTranslator(
  catalog: CatalogClient,
  env: Record<string, unknown>,
  turn: TurnModel,
  spent: SupplementalUsage,
): TitleTranslator {
  const chosen = translationModel(env, turn);
  if (chosen === null) return titleTranslator(catalog, () => Promise.resolve(null));
  const stream: ModelStream = (model, context, options) =>
    chosen.registry.streamSimple(model, context, streamOptionsFor(chosen, options));
  const complete = toollessCompletion(chosen.model, stream, (usage) => {
    spent.record(usage);
  });
  return titleTranslator(catalog, complete);
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
 * a tool-less call on a model, and WHICH model depends on whether this turn is
 * caller-keyed (`translationModel`, D18). It is the whole `TurnModel` rather
 * than a bare registry because that decision reads `callerKeyed`, which lives
 * on the same value.
 *
 * The same fallback is why this toolbox owns a `SupplementalUsage` (#1292):
 * that call is the one model call of a turn the pi Agent never makes, so the
 * toolbox is the only thing that can answer for its tokens, and `spent()` is
 * how the settlement collects them.
 */
export function turnToolbox(
  env: Record<string, unknown>,
  session: TurnCatalogSession,
  model: TurnModel,
): Toolbox {
  const catalog = turnCatalog(env);
  if (catalog === undefined) return EMPTY_TOOLBOX;
  const search = duckduckgoWebSearcher(webSearchFetch());
  const spent = new SupplementalUsage();
  const translate = turnTranslator(catalog, env, model, spent);
  const tools = agentToolbox({ catalog, session, search, translate });
  return { tools: () => tools, spent: () => spent.usage };
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

/**
 * The turn one alarm drives, with the deployment's configuration in it.
 *
 * `model` is null when this deployment could resolve none, and the turn is
 * still built (#1288): a DETERMINISTIC selection answers from the catalog and
 * reaches no provider, so only the loaded run can say whether the missing model
 * matters — which is `DurableTurn.#unrunnable`'s job, not this function's.
 * Without a model there is no toolbox to offer and no secret to scrub, so both
 * degrade to the modelless forms rather than being faked.
 */
function configuredTurn(
  parts: SessionTurnParts,
  store: TurnStore,
  model: TurnModel | null,
  envelope: TurnEnvelope,
): DurableTurn {
  // One sink for both paths: a selection streams no provider text, but the
  // scrub is a property of the TURN's credential rather than of who emitted a
  // frame, and two sinks would be two places to remember that.
  const emit = model === null ? parts.emit : turnFrameSink(parts.emit, model);
  return new DurableTurn({
    store: new EnvelopeStagingStore(store, envelope),
    model,
    toolbox: model === null ? EMPTY_TOOLBOX : turnToolbox(parts.env, envelope.session, model),
    answering: new TurnAnswering(envelope.session),
    memory: envelope.session,
    session: envelope.session,
    refs: envelope.session,
    selection: turnSelection(parts.env, envelope.session, emit),
    systemPrompt: envelope.systemPrompt,
    prices: usagePricesIn(parts.env),
    emit,
    owner: parts.owner,
    now: Date.now,
  });
}

/**
 * A turn with no model at all still ends the run rather than looping — the
 * sweeper would otherwise re-arm a turn that can never reach a provider,
 * forever — but WHERE that ending is decided moved with #1288.
 *
 * It used to be here, before the run was loaded, and that was wrong for one
 * kind of turn: a deterministic selection needs the catalog and no model, so a
 * deployment holding `CATALOG` without a model key failed every pick
 * `provider_failed`. Only the loaded run knows which kind of turn it is, so
 * the refusal now lives in `DurableTurn.#unrunnable`, where the run is in hand
 * — and it settles through the same failure path as any other, taking the
 * lease first, which is what makes it visible to a client watching the stream.
 */
async function driveOn(parts: SessionTurnParts, store: TurnStore, runId: string): Promise<void> {
  const model = turnModelFor(parts.env, parts.byok);
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
