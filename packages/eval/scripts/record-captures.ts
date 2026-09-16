/**
 * Record a prefix corpus with the production harness (#1558).
 *
 * The trajectory is always recorded fresh — the canonical case inputs may be
 * reused, their old trajectories may not. Two modes:
 *
 * - default: the published provider binding and the real catalog. Requires the
 *   binding's credential and `CATALOG_API_URL`, exactly like `eval:native`.
 * - `EVAL_RECORD_MODE=deterministic`: a scripted provider and the
 *   case-derived catalog fixture. The frozen bytes this writes are the ones
 *   committed under `fixtures/prefix-corpus/`, and the provenance says
 *   `provider: faux`, so nobody mistakes them for a real-model recording. The
 *   scripted provider streams every block whole and the recorder canonicalizes
 *   every identifier and clock reading, so re-recording the same commit
 *   rewrites the same bytes.
 *
 * The recorder refuses to write a corpus whose bytes contain a credential it
 * read, and refuses to record a boundary whose turn produced no pending
 * selection or no durable search reference.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createOperationModels } from '@animichi/agent/models';
import { canonicalSelectionCases, productionToolNames, promptIdentity, selectionPlans } from '../src/native/prefix-cases.ts';
import {
  assertNoCredentialMaterial, recordBoundaries, writePrefixCorpus,
  type PrefixRecordingPorts, type RecordingProvenance,
} from '../src/native/prefix-record.ts';
import { RECORDED_EPOCH } from '../src/native/prefix-canonical.ts';
import { configuredCatalog } from '../src/native/catalog-fetch.ts';
import { installedPiAgentVersion } from '../src/pins.ts';
import { EVAL_PROVIDERS, providerCatalog, readRunConfig } from '../src/native/native-run.ts';

const DEFAULT_OUT = fileURLToPath(new URL('../fixtures/prefix-corpus', import.meta.url));

/** Only the recorded selection corpus has a case-input mapping today. */
export const RECORDABLE_DATASETS = ['phase1c_selection_v1'] as const;

export interface CaptureConfig {
  readonly dataset: string;
  readonly out: string;
  readonly deterministic: boolean;
  readonly provider: (typeof EVAL_PROVIDERS)[number];
  readonly modelId: string;
  readonly commit: string;
}

export interface CaptureResult {
  readonly cases: number;
  readonly sources: readonly string[];
  readonly out: string;
}

/** Read only explicit recording controls; the run config supplies provider, model and commit. */
export function readCaptureConfig(env: NodeJS.ProcessEnv = process.env): CaptureConfig {
  const run = readRunConfig(env);
  if (!(RECORDABLE_DATASETS as readonly string[]).includes(run.datasetName)) {
    throw new RangeError(`${run.datasetName}: no recorded prefix corpus is defined for it — one of: ${RECORDABLE_DATASETS.join(', ')}`);
  }
  return { dataset: run.datasetName, out: env.EVAL_CAPTURE_OUT ?? DEFAULT_OUT,
    deterministic: env.EVAL_RECORD_MODE === 'deterministic', provider: run.provider, modelId: run.modelId, commit: run.testedCommit };
}

/** Record the configured corpus; deterministic mode needs no binding at all. */
export async function recordCapture(config: CaptureConfig, env: NodeJS.ProcessEnv = process.env): Promise<CaptureResult> {
  const deterministic = config.deterministic;
  const { ports, credential } = deterministic ? await deterministicCapture() : await productionCapture(config, env);
  const recorded = await recordBoundaries(selectionPlans(await canonicalSelectionCases()), ports,
    provenance(config, deterministic ? 'deterministic-case-fixture' : 'live'));
  assertNoCredentialMaterial(JSON.stringify(recorded), [credential]);
  await writePrefixCorpus(config.out, config.dataset, recorded);
  return { cases: recorded.length, sources: recorded.map((entry) => entry.inputs.prefix.file), out: config.out };
}

function provenance(config: CaptureConfig, catalog: string): RecordingProvenance {
  return { sdk: installedPiAgentVersion(), provider: config.deterministic ? 'faux' : config.provider,
    model: config.deterministic ? 'faux-model' : config.modelId, prompt: promptIdentity(), tools: productionToolNames(),
    commit: config.commit, catalog, recorded_at: recordedAt(config.deterministic) };
}

/**
 * The provenance clock. A deterministic corpus is pinned to the recording epoch
 * like every value it freezes, so a re-record is byte-identical; a real
 * recording says when it was made.
 */
function recordedAt(deterministic: boolean): string {
  return new Date(deterministic ? RECORDED_EPOCH : Date.now()).toISOString();
}

/** The committed corpus is reproducible without a credential or a live catalog. */
async function deterministicCapture(): Promise<{ ports: PrefixRecordingPorts; credential: string }> {
  const cases = await canonicalSelectionCases();
  const [catalogFixture, phase1c, faux] = await Promise.all([
    import('../test/native-prefix-catalog.ts'), import('../test/native-prefix-phase1c.ts'), import('../test/native-prefix-fixture.ts'),
  ]);
  return { ports: faux.scriptedPorts(phase1c.phase1cScripts(cases), catalogFixture.fixtureCatalog([], phase1c.phase1cCatalog(cases))),
    credential: '' };
}

/** The published provider binding and the real catalog, or a refusal naming what is missing. */
async function productionCapture(config: CaptureConfig, env: NodeJS.ProcessEnv): Promise<{ ports: PrefixRecordingPorts; credential: string }> {
  const credentialVar = config.provider === 'xiaomi' ? 'MIMO_API_KEY' : 'OPENCODE_API_KEY';
  const key = requireEnv(env, credentialVar);
  const catalogUrl = requireEnv(env, 'CATALOG_API_URL');
  const model = providerCatalog(config.provider).find((candidate) => candidate.id === config.modelId);
  if (model === undefined) throw new Error(`EVAL_MODEL "${config.modelId}" is not published by ${config.provider}`);
  const models = await createOperationModels(model, key);
  return { ports: { models, model, catalog: configuredCatalog(catalogUrl) }, credential: key };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`recording a prefix corpus requires ${name}`);
  return value;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) void main().catch(reportError);

async function main(): Promise<void> {
  const config = readCaptureConfig();
  const result = await recordCapture(config);
  process.stdout.write(`recorded ${String(result.cases)} prefix boundaries into ${result.out}\n`);
  for (const source of result.sources) process.stdout.write(`  ${source}\n`);
}

function reportError(error: unknown): void {
  process.stderr.write(`prefix recording failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
