/**
 * ANY-of-N: the set of model-call chains a case's trajectory may match.
 *
 * A case does not name one expected tool sequence — it names acceptable
 * *stages*, and each stage contributes one or more chains. The official
 * evaluators run once per chain and keep the best score, which is how the
 * dataset's disjunction survives evaluators that take a single expectation.
 *
 * Ported verbatim from `_GENERAL_QA_CHAINS`, `_STAGE_MODEL_CALL_CHAINS`,
 * `_STAGE_MIN_STEPS`, `accepted_chains_for_case`, `_model_call_chains_for_stages`
 * and `_acceptable_min_steps` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`.
 */

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import { type TranscriptResult, toolNames } from './transcript-view.ts';

/** One accepted sequence of locally-executed, model-initiated tool calls. */
export type ModelCallChain = readonly string[];

const GENERAL_QA_CHAINS: readonly ModelCallChain[] = [
  [],
  ['web_search'],
  ['translate_anime_title'],
  ['web_search', 'translate_anime_title'],
  ['translate_anime_title', 'web_search'],
];

const STAGE_MODEL_CALL_CHAINS = new Map<string, readonly ModelCallChain[]>([
  ['search_bangumi', [['resolve_anime', 'search_bangumi']]],
  ['search_nearby', [['search_nearby']]],
  ['plan_route', [['resolve_anime', 'search_bangumi', 'plan_route']]],
  ['plan_selected', [[]]],
  ['plan_multi', [[]]],
  ['clarify', [['resolve_anime'], []]],
  ['clarify_after_nearby', [['search_nearby']]],
  ['greet_user', [[]]],
  ['general_qa', GENERAL_QA_CHAINS],
]);

/** Ideal visible-step counts, carried over verbatim from `_STAGE_MIN_STEPS`. */
const STAGE_MIN_STEPS = new Map<string, number>([
  ['search_bangumi', 2],
  ['search_nearby', 1],
  ['plan_route', 3],
  ['plan_selected', 1],
  ['plan_multi', 1],
  ['clarify', 1],
  ['clarify_after_nearby', 2],
  ['greet_user', 0],
  ['general_qa', 0],
]);

/** An unknown stage accepts the empty chain and costs two ideal steps. */
const UNKNOWN_STAGE_CHAINS: readonly ModelCallChain[] = [[]];
const UNKNOWN_STAGE_MIN_STEPS = 2;
const SELECTION_CHAINS: readonly ModelCallChain[] = [[]];

/**
 * The chains that would accept this case. Both selection turns bypass the
 * model entirely, so they accept only the empty chain regardless of stage.
 */
export function acceptedChainsForCase(
  inputs: ExportedAgentInput,
  metadata: ExportedAgentExpected | undefined,
): readonly ModelCallChain[] {
  if (inputs.selected_point_ids !== null) {
    return SELECTION_CHAINS;
  }
  if (inputs.selected_candidate_ids !== null) {
    return SELECTION_CHAINS;
  }
  return chainsForStages(metadata?.acceptable_stages ?? []);
}

/** Ordered dedup across the stages' chains — Python's `dict.fromkeys`. */
function chainsForStages(stages: readonly string[]): readonly ModelCallChain[] {
  const unique = new Map<string, ModelCallChain>();
  for (const stage of stages) {
    for (const chain of STAGE_MODEL_CALL_CHAINS.get(stage) ?? UNKNOWN_STAGE_CHAINS) {
      unique.set(JSON.stringify(chain), chain);
    }
  }
  return [...unique.values()];
}

/**
 * Run `score` once per accepted chain and keep the best. A case with no
 * accepted chain scores 1.0 — `_best(..., empty=1.0)`: there was nothing to
 * violate.
 */
export function bestOverChains(
  chains: readonly ModelCallChain[],
  score: (chain: ModelCallChain) => number,
): number {
  return chains.length === 0 ? 1 : Math.max(...chains.map(score));
}

/**
 * The ideal step counts this case may be measured against. The three special
 * branches are checked in Python's order — a seeded place ambiguity wins over
 * the `clarify_after_nearby` geocode branch even when both apply.
 */
export function acceptableMinSteps(
  inputs: ExportedAgentInput,
  metadata: ExportedAgentExpected | undefined,
  result: TranscriptResult,
): readonly number[] {
  const stages = metadata?.acceptable_stages ?? [];
  if (stages.includes('plan_multi') && inputs.selected_candidate_ids !== null) {
    return [new Set(inputs.selected_candidate_ids).size + 1];
  }
  if (seededReason(inputs) === 'place_ambiguity') {
    return [1];
  }
  if (stages.includes('clarify_after_nearby') && geocoded(result)) {
    return [3];
  }
  return stageMinSteps(stages);
}

function stageMinSteps(stages: readonly string[]): readonly number[] {
  const minima = stages.map((stage) => STAGE_MIN_STEPS.get(stage) ?? UNKNOWN_STAGE_MIN_STEPS);
  return minima.length === 0 ? [1] : minima;
}

function seededReason(inputs: ExportedAgentInput): unknown {
  return inputs.seeded_pending?.reason ?? null;
}

/** `_actual_tools` is every step, not only the model-initiated ones. */
function geocoded(result: TranscriptResult): boolean {
  return toolNames(result.trajectory).includes('geocode');
}
