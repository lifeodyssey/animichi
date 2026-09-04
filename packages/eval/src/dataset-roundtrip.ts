import { fileURLToPath } from 'node:url';

import { Dataset } from 'logfire/evals';
import type { EvaluatorClass } from 'logfire/evals';

import { AGENT_EVALUATORS } from './evaluators/index.ts';

/**
 * The case shape pydantic-evals writes for this dataset family. `inputs` and
 * `metadata` mirror `AgentInput` / `AgentExpected` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py` field for field; `context`
 * and `seeded_pending` stay open maps because the Python source declares them
 * as `Mapping[str, object] | None`.
 */
export interface ExportedAgentInput {
  clarification_id: number | null;
  context: Record<string, unknown> | null;
  locale: string;
  query: string;
  seeded_pending: Record<string, unknown> | null;
  selected_candidate_ids: string[] | null;
  selected_point_ids: string[] | null;
}

export interface ExportedAgentExpected {
  acceptable_stages: string[];
  data_keys: string[];
  expect_nonempty: boolean;
}

/** Every case in the exported sets carries `expected_output: null`. */
export type ExportedAgentOutput = null;

/**
 * A loaded set. `Output` is the *task* output type, not the serialized
 * `expected_output` (which is always `null`): the read path leaves it at
 * `null`, while a run parametrizes it with the shaped turn the task returns.
 */
export type ExportedDatasetHandle<Output = ExportedAgentOutput> = Dataset<
  ExportedAgentInput,
  Output,
  ExportedAgentExpected
>;

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixturePath(setName: string): string {
  return `${FIXTURES_DIR}${setName}.json`;
}

/**
 * The independent expectation: the same cases as the Python dataclasses hold
 * them, written by `run_agent_eval.py --export-cases`. Comparing the loaded
 * dataset with the file it was loaded from would compare the file with itself.
 */
export function caseViewPath(setName: string): string {
  return `${FIXTURES_DIR}${setName}.cases.json`;
}

/**
 * Read one exported set exactly the way the W3 runner will.
 *
 * `customEvaluators` is the whole bet: the file names the eight Python
 * evaluators as bare strings, and `Dataset.fromFile` throws
 * `Unknown evaluator name: "<name>"` for any the caller did not register.
 */
export async function loadExportedDataset<Output = ExportedAgentOutput>(
  setName: string,
  evaluators: readonly EvaluatorClass[] = AGENT_EVALUATORS,
): Promise<ExportedDatasetHandle<Output>> {
  return Dataset.fromFile<ExportedAgentInput, Output, ExportedAgentExpected>(
    fixturePath(setName),
    { customEvaluators: evaluators },
  );
}
