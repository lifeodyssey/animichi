import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `stats.py`'s `load_case_strata`: case id → behaviour path.
 *
 * The strata come from the **canonical** dataset in `apps/agent`, not from the
 * exported fixture this package reads elsewhere. `Dataset.to_file` keeps only
 * the fields of `AgentExpected` (`acceptable_stages`, `data_keys`,
 * `expect_nonempty`), so a row's `path` does not survive the export — measured
 * on `fixtures/agent_eval_v3.json`, whose 662 cases carry no `path` anywhere.
 * Python reads the canonical file for the same reason; a stratified gate driven
 * off the exported fixture alone would silently degrade to `unstratified`.
 */

export const CANONICAL_DATASETS_DIR = fileURLToPath(
  new URL('../../../../apps/agent/src/animichi/tests/eval/datasets/', import.meta.url),
);

export function canonicalDatasetPath(setName: string): string {
  return `${CANONICAL_DATASETS_DIR}${setName}.json`;
}

/** Case-id to behaviour-path strata, from a canonical eval dataset. */
export function loadCaseStrata(path: string): Record<string, string> {
  const rows: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new TypeError(`${path}: an eval dataset must be a list of rows`);
  }
  return Object.fromEntries(rows.map((row, index) => stratumEntry(row, index, path)));
}

function stratumEntry(row: unknown, index: number, path: string): [string, string] {
  const fields = row !== null && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const id = fields.id;
  const behaviour = fields.path;
  if (typeof id !== 'string' || typeof behaviour !== 'string') {
    throw new TypeError(`${path}: row ${String(index)} has no string "id" and "path"`);
  }
  return [id, behaviour];
}
