import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * The committed baseline a model-change measurement reports next to (#1935).
 *
 * A run on a new model sits beside a committed baseline from the old one; without the
 * name in the report itself, score movement reads as a code regression when it is the
 * model switch. `EVAL_BASELINE` names the baseline artifact, and the report records the
 * baseline's model, the artifact and the comparison kind — derived from the two model
 * identities, never asserted by hand.
 */

/** One kind of comparison a report can declare about its baseline. */
export type BaselineComparison = 'model-change' | 'same-model';

export interface BaselineReference {
  /** The baseline run's recorded model identity (`provider:id@baseUrl`). */
  readonly model: string;
  /** The committed artifact the identity was read from, repo-relative when inside the repository. */
  readonly artifact: string;
  readonly comparison: BaselineComparison;
}

/** The two fields a committed baseline artifact may carry its model identity in. */
interface BaselineRecord {
  readonly model?: unknown;
  readonly baseline_model?: unknown;
}

/**
 * Resolve the named baseline artifact against `runModel`, or answer `null` when no
 * baseline was named — an unnamed baseline is recorded as `null`, never omitted.
 * A missing, unreadable or model-less artifact is a failure, not a silent skip.
 */
export async function resolveBaseline(named: string | undefined, runModel: string): Promise<BaselineReference | null> {
  if (named === undefined) return null;
  const record = await readArtifact(named);
  const model = baselineModel(record, named);
  return { model, artifact: artifactPath(named), comparison: model === runModel ? 'same-model' : 'model-change' };
}

async function readArtifact(named: string): Promise<BaselineRecord> {
  const path = absolutePath(named);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`baseline artifact "${named}" does not exist (read as ${path}: ${message(error)})`, { cause: error });
  }
  try {
    return JSON.parse(text) as BaselineRecord;
  } catch (error) {
    throw new Error(`baseline artifact "${named}" is not valid JSON: ${message(error)}`, { cause: error });
  }
}

function baselineModel(record: BaselineRecord, named: string): string {
  const model = [record.model, record.baseline_model].find(isModelString);
  if (model === undefined) {
    throw new Error(`baseline artifact "${named}" names no model (expected "model" or "baseline_model")`);
  }
  return model;
}

function isModelString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Repo-relative when the artifact lives in the repository, so a committed report stays portable. */
function artifactPath(named: string): string {
  const path = absolutePath(named);
  const root = repositoryRoot();
  return path.startsWith(root) ? relative(root, path) : path;
}

function absolutePath(named: string): string {
  return isAbsolute(named) ? named : resolve(repositoryRoot(), named);
}

function repositoryRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
