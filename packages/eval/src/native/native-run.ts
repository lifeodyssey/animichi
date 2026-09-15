import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shutdown } from '@pydantic/logfire-node';
import { xiaomiProvider } from '@earendil-works/pi-ai/providers/xiaomi';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import type { Api, Model, ProviderHeaders, Provider } from '@earendil-works/pi-ai';
import type { EvaluationReport } from 'logfire/evals';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context, Session } from '@earendil-works/pi-agent-core';
import { createOperationModels } from '@animichi/agent/models';
import { NATIVE_AGENT_OPTIONS } from '@animichi/agent';
import { createCatalogClient, type PilgrimageToolContext } from '@animichi/agent/tools';
import { inProcessTask } from './in-process-task.ts';
import { configuredCatalog } from './catalog-fetch.ts';
import { ExecutionPass } from './execution-evaluator.ts';
import { loadNativeDataset, type LoadedNativeDataset } from './evaluation-dataset.ts';
import { addSpendMetadata, experimentMetadata, writeEvaluationReport } from './evaluation-report.ts';
import type { NativeCaseMetadata, NativeOutput, NativeTaskInput } from './evaluation-types.ts';
import { traceSampleRate } from './trace-sampling.ts';

export interface NativeRunConfig {
  readonly datasetName: string;
  readonly provider: EvalProvider;
  readonly modelId: string;
  readonly repeat: number;
  readonly maxConcurrency: number;
  readonly smoke: boolean;
  readonly traceSampling: number;
  readonly testedCommit: string;
  readonly reportPath: string;
}

export interface NativeRunResult {
  readonly report?: EvaluationReport<NativeTaskInput, NativeOutput, NativeCaseMetadata>;
  readonly loaded: LoadedNativeDataset;
  readonly config: NativeRunConfig;
  readonly dryRun: boolean;
}

/** The two provider APIs `createOperationModels` can stream; the published catalog fixes one. */
type EvalApi = 'openai-completions' | 'anthropic-messages';

/** The published provider bindings the documented command can run. */
export const EVAL_PROVIDERS = ['xiaomi', 'opencode-go'] as const;

export type EvalProvider = (typeof EVAL_PROVIDERS)[number];

/** One binding: the published catalog it serves, and the variable its credential must arrive in. */
interface ProviderBinding {
  readonly models: () => Pick<Provider<EvalApi>, 'getModels'>;
  readonly credentialVar: string;
  readonly requestHeaders?: () => ProviderHeaders;
}

/**
 * Provider selection is explicit and never falls back: a run reads one credential variable,
 * and the model is resolved from that one provider's published catalog.
 */
const PROVIDER_BINDINGS: Readonly<Record<EvalProvider, ProviderBinding>> = {
  xiaomi: { models: xiaomiProvider, credentialVar: 'MIMO_API_KEY' },
  'opencode-go': { models: opencodeGoModels, credentialVar: 'OPENCODE_API_KEY', requestHeaders: opencodeGoSession },
};

/**
 * OpenCode Go refuses a request without its session header (HTTP 400 `MissingSessionID`), exactly as
 * its own clients send it. One run is one session: the identifier is fresh per run and stable across
 * every case the run evaluates.
 */
function opencodeGoSession(): ProviderHeaders {
  return { 'x-opencode-session': randomUUID() };
}

/** OpenCode Go publishes `openai-responses` models too; this eval can only stream these two APIs. */
function opencodeGoModels(): Pick<Provider<EvalApi>, 'getModels'> {
  const provider = opencodeGoProvider();
  const models = provider.getModels().filter(isEvalModel);
  return { getModels: () => models };
}

/** The selected binding's published catalog, for a caller that must inspect it without egress. */
export function providerCatalog(provider: EvalProvider): readonly Model<EvalApi>[] {
  return PROVIDER_BINDINGS[provider].models().getModels();
}

function isEvalModel(model: Model<Api>): model is Model<EvalApi> {
  return model.api === 'openai-completions' || model.api === 'anthropic-messages';
}

/** Provider catalog and egress transports. The documented command supplies none of these. */
export interface NativeRunPorts {
  readonly provider: Pick<Provider<EvalApi>, 'getModels'>;
  readonly providerFetch: typeof globalThis.fetch;
  readonly catalogFetch: typeof globalThis.fetch;
}

/** Real egress and the selected published catalog. Only local composition tests pass ports. */
function productionPorts(provider: EvalProvider): NativeRunPorts {
  return { provider: PROVIDER_BINDINGS[provider].models(), providerFetch: globalThis.fetch, catalogFetch: globalThis.fetch };
}

/** Read only explicit run controls; EVAL_SMOKE is the sole case-count reduction. */
export function readRunConfig(env: NodeJS.ProcessEnv = process.env): NativeRunConfig {
  const datasetName = env.EVAL_DATASET ?? 'agent_eval_heldout_v1';
  const provider = evalProvider(env.EVAL_PROVIDER ?? 'xiaomi');
  const smoke = smokeEnabled(env.EVAL_SMOKE);
  const modelId = nonEmpty(env.EVAL_MODEL ?? 'mimo-v2.5', 'EVAL_MODEL');
  const repeat = positiveInt(env.EVAL_REPEAT ?? '1', 'EVAL_REPEAT');
  const maxConcurrency = positiveInt(env.EVAL_MAX_CONCURRENCY ?? '1', 'EVAL_MAX_CONCURRENCY');
  const traceSampling = traceSampleRate(env.EVAL_TRACE_SAMPLE_RATE);
  const testedCommit = nonEmpty(env.EVAL_COMMIT ?? currentCommit(), 'EVAL_COMMIT');
  const reportPath = env.EVAL_REPORT_PATH ?? defaultReportPath(datasetName);
  return { datasetName, provider, modelId, repeat, maxConcurrency, smoke, traceSampling, testedCommit, reportPath };
}

/** Execute real in-process E1 work, or print the same validated plan in dry-run mode. */
export async function runNativeEvaluation(
  config: NativeRunConfig,
  env: NodeJS.ProcessEnv = process.env,
  ports: NativeRunPorts = productionPorts(config.provider),
): Promise<NativeRunResult> {
  try {
    return await planAndEvaluate(config, env, ports);
  } finally {
    await shutdown();
  }
}

async function planAndEvaluate(config: NativeRunConfig, env: NodeJS.ProcessEnv, ports: NativeRunPorts): Promise<NativeRunResult> {
  const loaded = await loadNativeDataset(config.datasetName, config.smoke);
  const model = findModel(ports.provider.getModels(), config.modelId, config.provider);
  if (env.EVAL_DRY_RUN === '1') return { loaded, config, dryRun: true };
  const [key, catalogUrl] = requiredBindings(env, PROVIDER_BINDINGS[config.provider].credentialVar);
  return await evaluateBinding(loaded, config, model, ports, key, catalogUrl);
}

async function evaluateBinding(
  loaded: LoadedNativeDataset, config: NativeRunConfig, model: Model<EvalApi>,
  ports: NativeRunPorts, key: string, catalogUrl: string,
): Promise<NativeRunResult> {
  const models = await createOperationModels(model, key, ports.providerFetch, PROVIDER_BINDINGS[config.provider].requestHeaders?.());
  try {
    const catalog = configuredCatalog(catalogUrl, ports.catalogFetch);
    return await writeRunReport(loaded, config, await evaluate(loaded, config, { models, model, catalog }));
  } finally {
    await models.logout(model.provider);
  }
}

async function writeRunReport(
  loaded: LoadedNativeDataset, config: NativeRunConfig,
  report: EvaluationReport<NativeTaskInput, NativeOutput, NativeCaseMetadata>,
): Promise<NativeRunResult> {
  addSpendMetadata(report);
  const rendered = await writeEvaluationReport(report, config.reportPath);
  process.stdout.write(`${rendered}\n`);
  process.stdout.write(`Native EvaluationReport: ${config.reportPath}\n`);
  return { loaded, config, report, dryRun: false };
}

/**
 * The SDK options the documented run uses. `retries: 0` is the reliability guard: a Logfire
 * task failure is a real attempt to report, never one `retryTask` silently replaces.
 */
export function evaluationOptions(config: NativeRunConfig, metadata: Record<string, unknown>) {
  return { repeat: config.repeat, maxConcurrency: config.maxConcurrency, retryTask: { retries: 0 }, metadata };
}

/** The provider models, their model and the catalog every attempt in one run shares. */
interface RunComposition {
  readonly models: Awaited<ReturnType<typeof createOperationModels>>;
  readonly model: Model<EvalApi>;
  readonly catalog: ReturnType<typeof createCatalogClient>;
}

async function evaluate(
  loaded: LoadedNativeDataset,
  config: NativeRunConfig,
  composition: RunComposition,
): Promise<EvaluationReport<NativeTaskInput, NativeOutput, NativeCaseMetadata>> {
  loaded.dataset.addEvaluator(new ExecutionPass());
  const metadata = experimentMetadata(loaded, config, composition.model);
  return loaded.dataset.evaluate(productionAttempt(composition), evaluationOptions(config, metadata));
}

/** One dataset attempt: the native task with the run's models, model and real tools. */
function productionAttempt(composition: RunComposition) {
  return (input: NativeTaskInput) =>
    inProcessTask(input.prompt, (session) => attemptOptions(session, input, composition), BACKGROUND_CONTEXT);
}

/** The AgentHarness options one attempt runs with. */
function attemptOptions(session: Session, input: NativeTaskInput, composition: RunComposition) {
  return {
    ...NATIVE_AGENT_OPTIONS,
    session,
    models: composition.models,
    model: composition.model,
    toolContext: productionTools(session, input.locale, composition),
  };
}

function productionTools(session: Session, locale: string, composition: RunComposition): PilgrimageToolContext {
  return {
    session,
    branch: 'main',
    locale,
    catalog: composition.catalog,
    webFetch: globalThis.fetch,
    translation: { models: composition.models, model: composition.model, payer: 'platform' as const },
    assertAuthorized: allow,
    reserveToolUsage: allow,
  };
}

/** No account, budget or quota guards a local eval, so both tool guards only honour cancellation. */
function allow(_id: string, context: Context): Promise<void> {
  context.abortSignal?.throwIfAborted();
  return Promise.resolve();
}

function findModel(models: readonly Model<EvalApi>[], id: string, provider: EvalProvider): Model<EvalApi> {
  const model = models.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`EVAL_MODEL "${id}" is not published by ${provider} for the in-process eval`);
  return model;
}

function requiredBindings(env: NodeJS.ProcessEnv, credentialVar: string): [string, string] {
  const key = env[credentialVar];
  const catalogUrl = env.CATALOG_API_URL;
  const missing = [
    ...(key?.trim() ? [] : [credentialVar]),
    ...(catalogUrl?.trim() ? [] : ['CATALOG_API_URL']),
  ];
  if (missing.length > 0) throw new Error(`native eval requires configured bindings: ${missing.join(', ')}`);
  if (key === undefined || catalogUrl === undefined) throw new Error('native eval bindings disappeared');
  return [key, catalogUrl];
}

function evalProvider(value: string): EvalProvider {
  if (value === 'xiaomi') return 'xiaomi';
  if (value === 'opencode-go') return 'opencode-go';
  throw new Error(`EVAL_PROVIDER must be one of: ${EVAL_PROVIDERS.join(', ')}`);
}

function smokeEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('EVAL_SMOKE must be 0 or 1');
}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new RangeError(`${name} must be a positive integer`);
  return parsed;
}

function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} must be non-empty`);
  return value;
}

function currentCommit(): string {
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

/** No explicit path means scratch output: the run owns no directory in the repository. */
function defaultReportPath(dataset: string): string {
  return join(tmpdir(), `native-${dataset}.json`);
}
