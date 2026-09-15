import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readRunConfig, runNativeEvaluation, type NativeRunResult } from '../src/native/native-run.ts';

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) void main().catch(reportError);

async function main(): Promise<void> {
  const result = await runNativeEvaluation(readRunConfig());
  if (result.dryRun) writeDryRunPlan(result);
}

/** EVAL_DRY_RUN prints the validated plan and stops before any binding is required. */
function writeDryRunPlan(result: NativeRunResult): void {
  const plan = {
    dataset: result.config.datasetName,
    provider: result.config.provider,
    model: result.config.modelId,
    repeat: result.config.repeat,
    maxConcurrency: result.config.maxConcurrency,
    sampling: 'iid',
    smoke: result.config.smoke,
    sourceCases: result.loaded.sourceCaseCount,
    selectedCases: result.loaded.selectedCaseCount,
    unsupportedShapes: result.loaded.unsupportedShapes,
    commit: result.config.testedCommit,
  };
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`native eval failed: ${message}\n`);
  process.exitCode = 1;
}
