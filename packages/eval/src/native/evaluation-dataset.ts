import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Case, Dataset } from 'logfire/evals';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import {
  FROZEN_DATASET_CATEGORY,
  FROZEN_DATASET_COUNTS,
  frozenDataset,
  type FrozenDatasetCount,
} from '../dataset-sets.ts';
import {
  declareRequiredAssertions,
  requiredAssertionsOf,
  type CaseCategory,
} from './required-assertions.ts';
import type { NativeCaseMetadata, NativeTaskInput } from './evaluation-types.ts';

const PACKAGE_URL = new URL('../../', import.meta.url);
const SMOKE_CASES = 3;

/**
 * Preserved corpus sets the native loader cannot express as a prompt task yet: their
 * cases carry journey expectations and translation fields rather than prompt/locale.
 * Naming them keeps "not migrated" distinct from a caller's typo, and reports the
 * uncovered corpus separately from source preservation and evaluated coverage.
 */
const UNMIGRATED_CORPUS_SETS: readonly string[] = ['runtime_journey_v1', 'translation_v1'];

/**
 * Sets whose native task is a recorded prefix fork rather than a flat prompt.
 * Loading the flat export would silently drop the pending selection the case
 * is about (#1558), so the flat loader refuses them by name.
 */
const PREFIX_CORPUS_SETS: readonly string[] = ['phase1c_selection_v1'];

export interface LoadedNativeDataset {
  readonly dataset: Dataset<NativeTaskInput, LaneSnapshot, NativeCaseMetadata>;
  readonly sourceCaseCount: number;
  readonly selectedCaseCount: number;
  readonly unsupportedShapes: Readonly<Record<string, number>>;
}

/** One planned case identity and the assertions its category requires. */
export interface PlannedCase {
  readonly name: string;
  readonly requiredAssertions: readonly string[];
}

/** Load a preserved export and make the source shape explicit to the native SDK. */
export async function loadNativeDataset(name: string, smoke: boolean): Promise<LoadedNativeDataset> {
  if (UNMIGRATED_CORPUS_SETS.includes(name)) throw new RangeError(unmigrated(name));
  if (PREFIX_CORPUS_SETS.includes(name)) throw new RangeError(prefixCorpus(name));
  const frozen = frozenDataset(name);
  const parsed = await readFrozenCases(frozen);
  return toLoadedDataset(frozen.name, parsed, smoke);
}
/** Read the frozen fixture and hold it to its declared case count. */
async function readFrozenCases(frozen: FrozenDatasetCount): Promise<readonly ParsedCase[]> {
  const raw = JSON.parse(await readFile(datasetPath(frozen.name), 'utf8')) as unknown;
  const document = readDocument(raw, frozen.name);
  if (document.cases.length !== frozen.caseCount) {
    throw new Error(`${frozen.name}: expected ${String(frozen.caseCount)} cases, got ${String(document.cases.length)}`);
  }
  return document.cases.map(parseCase);
}

/** The selected cases as a dataset, with the shape refusal applied to exactly that selection. */
function toLoadedDataset(name: string, parsed: readonly ParsedCase[], smoke: boolean): LoadedNativeDataset {
  const category = datasetCategory(name);
  const selected = selectCases(name, parsed, smoke);
  rejectUnsupported(name, selected);
  return {
    dataset: new Dataset({ name, cases: selected.map((entry) => toCase(entry, category)) }),
    sourceCaseCount: parsed.length,
    selectedCaseCount: selected.length,
    unsupportedShapes: countUnsupported(parsed),
  };
}

/**
 * The planned identities of a loaded set: the fixed denominator pass^k must
 * keep, even for a case the SDK never started. Reading it from the dataset
 * means the plan cannot drift from the cases the run actually schedules.
 */
export function plannedCases(loaded: LoadedNativeDataset): readonly PlannedCase[] {
  return loaded.dataset.cases.map((entry) => ({
    name: caseNameOf(entry.name),
    requiredAssertions: requiredAssertionsOf(entry.metadata),
  }));
}

function selectCases(name: string, parsed: readonly ParsedCase[], smoke: boolean): readonly ParsedCase[] {
  if (!smoke) return parsed;
  const selected = parsed.slice(0, SMOKE_CASES);
  if (selected.length !== SMOKE_CASES) throw new Error(`${name}: smoke requires ${String(SMOKE_CASES)} cases`);
  return selected;
}

interface Document {
  readonly cases: readonly Record<string, unknown>[];
}

interface ParsedCase {
  readonly name: string;
  readonly inputs: NativeTaskInput;
  readonly metadata: NativeCaseMetadata;
  readonly shape: string;
}

function prefixCorpus(name: string): string {
  return `${name} is evaluated from recorded native prefix forks, not from the flat export — `
    + `run its deterministic selection (pnpm --filter @animichi/eval eval:prefix-selection) instead`;
}

function unmigrated(name: string): string {
  return `${name} is a preserved corpus set without a native task/expectation migration yet — `
    + `available sets: ${FROZEN_DATASET_COUNTS.map((set) => set.name).join(', ')}`;
}

function datasetPath(name: string): URL {
  return name === 'agent_eval_v3'
    ? new URL('datasets/source/agent_eval_v3.json', PACKAGE_URL)
    : new URL(`fixtures/${name}.json`, PACKAGE_URL);
}

function readDocument(raw: unknown, name: string): Document {
  const record = objectOf(raw, name);
  const cases = record.cases;
  if (!Array.isArray(cases)) throw new TypeError(`${name}: cases must be an array`);
  return { cases: cases.map((entry, index) => objectOf(entry, `${name} case ${String(index)}`)) };
}

function parseCase(record: Record<string, unknown>, index: number): ParsedCase {
  const where = `case ${String(index)}`;
  const name = stringOf(record.name, `${where}.name`);
  const inputRecord = objectOf(record.inputs, `${where}.inputs`);
  const prompt = textOf(inputRecord.prompt ?? inputRecord.query, `${where}.inputs.prompt`);
  const locale = stringOf(inputRecord.locale, `${where}.inputs.locale`);
  const metadata = objectOf(record.metadata ?? {}, `${where}.metadata`);
  const shape = taskShape(inputRecord, metadata);
  return { name, inputs: { prompt, locale }, metadata, shape };
}

function taskShape(input: Record<string, unknown>, metadata: Record<string, unknown>): string {
  if (metadata.seeded_context !== undefined || input.context !== null && input.context !== undefined) {
    return 'session-preseed';
  }
  const selected = metadata.seeded_selected_point_ids ?? input.selected_point_ids;
  if (Array.isArray(selected) && selected.length > 0) return 'selection-prefix';
  return 'none';
}

function countUnsupported(cases: readonly ParsedCase[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of cases) if (entry.shape !== 'none') counts[entry.shape] = (counts[entry.shape] ?? 0) + 1;
  return counts;
}

function rejectUnsupported(name: string, cases: readonly ParsedCase[]): void {
  const unsupported = countUnsupported(cases);
  if (Object.keys(unsupported).length > 0) {
    const summary = Object.entries(unsupported).map(([shape, count]) => `${shape}=${String(count)}`).join(', ');
    const examples = cases.filter((entry) => entry.shape !== 'none').slice(0, 3).map((entry) => entry.name).join(', ');
    throw new Error(`${name}: unsupported native task shapes (${summary}); examples: ${examples}`);
  }
  const empty = cases.find((entry) => entry.inputs.prompt.trim() === '');
  if (empty) throw new TypeError(`${name}: case ${empty.name}.inputs.prompt: expected a non-empty string`);
}

function toCase(entry: ParsedCase, category: CaseCategory): Case<NativeTaskInput, LaneSnapshot, NativeCaseMetadata> {
  return new Case({ name: entry.name, inputs: entry.inputs,
    metadata: declareRequiredAssertions(entry.metadata, category) });
}

function datasetCategory(name: string): CaseCategory {
  const category = FROZEN_DATASET_CATEGORY[name];
  if (category === undefined) throw new RangeError(`${name}: no declared case category`);
  return category;
}

function caseNameOf(name: string | undefined): string {
  if (name === undefined || name.trim() === '') throw new TypeError('a loaded case needs a name to be planned');
  return name;
}

function objectOf(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${where}: expected a non-empty string`);
  return value;
}

function textOf(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new TypeError(`${where}: expected a string`);
  return value;
}

export function nativeDatasetRoot(): string {
  return fileURLToPath(PACKAGE_URL);
}
