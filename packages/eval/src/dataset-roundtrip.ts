import { fileURLToPath } from 'node:url';

import { Dataset, Evaluator } from 'logfire/evals';
import type { EvaluatorClass, EvaluatorContext } from 'logfire/evals';

import { EVALUATOR_NAMES, type EvaluatorName } from './evaluator-names.ts';

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

export type ExportedDatasetHandle = Dataset<
  ExportedAgentInput,
  ExportedAgentOutput,
  ExportedAgentExpected
>;

/**
 * A registered evaluator that refuses to score. It exists so the round trip
 * can prove the *wiring* — name resolution and instantiation — without
 * pretending W3-3's scoring is done.
 */
abstract class UnimplementedEvaluator extends Evaluator<
  ExportedAgentInput,
  ExportedAgentOutput,
  ExportedAgentExpected
> {
  evaluate(_ctx: EvaluatorContext<ExportedAgentInput, ExportedAgentOutput, ExportedAgentExpected>): never {
    throw new Error(`not implemented: ${this.getResultName()}`);
  }
}

function unimplementedEvaluatorClass(name: EvaluatorName): EvaluatorClass {
  const declared = class extends UnimplementedEvaluator {
    static override readonly evaluatorName = name;
  };
  Object.defineProperty(declared, 'name', { value: name });
  return declared;
}

/** The eight stubs, in the order the Python exporter serializes them. */
export const UNIMPLEMENTED_EVALUATORS: readonly EvaluatorClass[] =
  EVALUATOR_NAMES.map(unimplementedEvaluatorClass);

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
export async function loadExportedDataset(
  setName: string,
  evaluators: readonly EvaluatorClass[] = UNIMPLEMENTED_EVALUATORS,
): Promise<ExportedDatasetHandle> {
  return Dataset.fromFile<ExportedAgentInput, ExportedAgentOutput, ExportedAgentExpected>(
    fixturePath(setName),
    { customEvaluators: evaluators },
  );
}
