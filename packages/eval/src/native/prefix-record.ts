/**
 * Recording and freezing prefix corpora (#1558).
 *
 * A boundary is recorded with the production harness on a real native
 * `JsonlSessionRepo`: the model reaches the intended pending state through the
 * production tools, and the session file that results is canonicalized and
 * frozen. The recorder never builds entries by hand and never copies state
 * between repositories; it normalizes the session header's machine-specific
 * `cwd` and every machine-specific value the SDK mints (`prefix-canonical.ts`),
 * and refuses to freeze a source that contains a credential the caller read or
 * a value it cannot canonicalize.
 *
 * The frozen session id is the case name, so a reader finds the source by the
 * case it belongs to. Boundaries are recorded with a fixed clock and a scripted
 * provider, so two recordings of the same script freeze the same bytes.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { objectOrNull } from '../json-object.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrThrow, type AgentMessage, type Context, type Entry, type MessageEntry, type Session } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { JsonlSessionRepo, value } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT, withoutAbortSignal } from '@earendil-works/chord/context';
import { createPilgrimageHarness } from '@animichi/agent/harness';
import { projectPilgrimage } from '@animichi/agent/tools';
import { NATIVE_AGENT_OPTIONS } from '@animichi/agent';
import type { createCatalogClient } from '@animichi/agent/tools';
import { RECORDED_EPOCH, canonicalizeSessionText, canonicalRecordedState } from './prefix-canonical.ts';
import {
  PrefixCaseInput, PrefixCaseMetadata, type ExpectedNextAction,
  type ExpectedSelection, type PrefixCaseMetadata as Metadata, type PrefixState,
} from './prefix-corpus.ts';

/** The portable logical `cwd` every frozen source header carries. */
export const PREFIX_SESSION_CWD = 'animichi-eval-prefix';

/**
 * The production host persists the accepted turn's bounded input under this
 * address before accept; the eval tier mirrors the address because it may not
 * import `workers/edge`.
 */
export const OPERATION_INPUT_NAMESPACE = 'animichi.operation.input';

type HarnessOptions = Parameters<typeof createPilgrimageHarness>[0];

/** Provenance every recorded boundary in one corpus shares; each case adds its boundary. */
export type RecordingProvenance = Omit<Metadata['recording'], 'boundary'>;

/** One intended prefix boundary: the case it belongs to and the turn that reaches it. */
export interface PrefixRecordingPlan {
  readonly id: string;
  readonly prompt: string;
  readonly locale: string;
  readonly boundary: string;
  readonly expectedNextAction: ExpectedNextAction;
  readonly selection?: { readonly candidateIds: readonly string[]; readonly expected: ExpectedSelection };
}

/** The production harness composition a recording runs on. */
export interface PrefixRecordingPorts {
  readonly models: HarnessOptions['models'];
  readonly model: HarnessOptions['model'];
  readonly catalog: ReturnType<typeof createCatalogClient>;
}

export interface PrefixRecordedCase {
  readonly name: string;
  readonly inputs: PrefixCaseInput;
  readonly metadata: Metadata;
  readonly sourceText: string;
}

/** The bounded host input scalar a recorded turn carries; the tested action needs it. */
export async function persistRecordedInput(session: Session, plan: PrefixRecordingPlan, context: Context): Promise<void> {
  await session.setValue(value<{ locale: string }>(OPERATION_INPUT_NAMESPACE, plan.id), { locale: plan.locale }, context);
}

/** Record every boundary through the production harness, then freeze its session file. */
export async function recordBoundaries(
  plans: readonly PrefixRecordingPlan[], ports: PrefixRecordingPorts, provenance: RecordingProvenance,
  context: Context = BACKGROUND_CONTEXT,
): Promise<readonly PrefixRecordedCase[]> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-record-'));
  const repo = new JsonlSessionRepo({
    fileSystem: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root, now: () => RECORDED_EPOCH,
  });
  try {
    const recorded: PrefixRecordedCase[] = [];
    for (const plan of plans) recorded.push(await recordOne(repo, plan, ports, provenance, context));
    return recorded;
  } finally {
    await repo.close(withoutAbortSignal(context));
    await rm(root, { recursive: true, force: true });
  }
}

async function recordOne(
  repo: JsonlSessionRepo, plan: PrefixRecordingPlan, ports: PrefixRecordingPorts,
  provenance: RecordingProvenance, context: Context,
): Promise<PrefixRecordedCase> {
  const session = await repo.create({ cwd: PREFIX_SESSION_CWD, id: plan.id }, context);
  await persistRecordedInput(session, plan, context);
  const state = await recordedState(session, plan, ports, context);
  const canonical = canonicalizeSessionText(freezeSessionText(await readFile(session.metadata.path, 'utf8')));
  return { name: plan.id, inputs: prefixInputs(plan),
    metadata: prefixMetadata(plan, canonicalRecordedState(state, canonical.ids), provenance), sourceText: canonical.text };
}

async function runBoundaryTurn(
  session: Session, plan: PrefixRecordingPlan, ports: PrefixRecordingPorts, context: Context,
): Promise<BoundaryObservation> {
  const options: HarnessOptions = {
    ...NATIVE_AGENT_OPTIONS, session, models: ports.models, model: ports.model,
    toolContext: { session, branch: 'main', locale: plan.locale, catalog: ports.catalog,
      assertAuthorized: allow, reserveToolUsage: allow },
  };
  const { harness } = await createPilgrimageHarness(options, context);
  try {
    getOrThrow(await (await harness.lane('main', context)).prompt(plan.prompt, undefined, context));
    return await observeBoundary(session, plan, context);
  } finally {
    await harness.close(withoutAbortSignal(context));
  }
}

interface BoundaryObservation {
  readonly state: PrefixState;
}

/**
 * Read the boundary state while the harness still owns the session: the harness
 * closes its session, so every read of the recorded state happens inside it.
 */
async function observeBoundary(session: Session, plan: PrefixRecordingPlan, context: Context): Promise<BoundaryObservation> {
  const entries = await session.findEntries(undefined, context);
  const pending = projectPilgrimage(entries).clarification;
  if (pending === undefined) throw new Error(`recording ${plan.id}: the boundary turn left no pending selection`);
  const stored = await session.getValue(value<{ locale: string }>(OPERATION_INPUT_NAMESPACE, plan.id), context);
  if (stored === undefined) throw new Error(`recording ${plan.id}: the recorded input scalar was not committed`);
  return { state: { kind: 'pending_selection', reason: reasonOf(pending.reason), clarification_id: pending.id, entry_id: pending.entryId,
    candidates: pending.candidates, references: [recordedReference(entries, plan)],
    scalars: [{ namespace: OPERATION_INPUT_NAMESPACE, key: plan.id, value: stored.value }] } };
}

/** The committed search result the boundary keeps; a reference that cannot be re-read is not frozen. */
function recordedReference(entries: readonly Entry[], plan: PrefixRecordingPlan) {
  const entry = entries.find(isSearchResultEntry);
  if (entry === undefined) throw new Error(`recording ${plan.id}: the boundary turn left no durable search reference`);
  return { kind: 'search_result' as const, entry_id: entry.id, tool: entry.message.toolName as 'search_bangumi' | 'search_nearby' };
}

/** The tool-result entry whose id is a durable search reference. */
type SearchResultEntry = MessageEntry & { message: Extract<AgentMessage, { role: 'toolResult' }> };

function isSearchResultEntry(entry: Entry): entry is SearchResultEntry {
  if (entry.type !== 'message') return false;
  const { message } = entry;
  if (message.role !== 'toolResult' || message.isError) return false;
  const kind = objectOrNull(message.details)?.kind;
  return (message.toolName === 'search_bangumi' && kind === 'bangumi')
    || (message.toolName === 'search_nearby' && kind === 'nearby');
}

async function recordedState(
  session: Session, plan: PrefixRecordingPlan, ports: PrefixRecordingPorts, context: Context,
): Promise<PrefixState> {
  return (await runBoundaryTurn(session, plan, ports, context)).state;
}

/** The two pending reasons whose candidates carry a selection; others are not a boundary. */
function reasonOf(reason: string): 'anime_ambiguity' | 'place_ambiguity' {
  if (reason === 'anime_ambiguity' || reason === 'place_ambiguity') return reason;
  throw new Error(`recording: ${reason} is not a pending-selection boundary`);
}

function prefixInputs(plan: PrefixRecordingPlan): PrefixCaseInput {
  return PrefixCaseInput.parse({ prompt: plan.prompt, locale: plan.locale,
    prefix: { file: `${plan.id}.jsonl`, session_id: plan.id, boundary: plan.boundary },
    ...(plan.selection === undefined ? {} : { selection: { candidateIds: [...plan.selection.candidateIds] } }) });
}

function prefixMetadata(plan: PrefixRecordingPlan, state: PrefixState, provenance: RecordingProvenance): Metadata {
  return PrefixCaseMetadata.parse({
    recording: { ...provenance, boundary: plan.boundary },
    expected_next_action: plan.expectedNextAction,
    prefix_state: state,
    ...(plan.selection === undefined ? {} : { expected_selection: plan.selection.expected }),
  });
}

/** Normalize the header `cwd` so a frozen source is portable; every other byte is canonicalized, never edited. */
export function freezeSessionText(text: string): string {
  const lines = text.split('\n');
  const header: unknown = JSON.parse(lines[0] ?? '');
  if (typeof header !== 'object' || header === null || Array.isArray(header)) throw new Error('frozen source: header must be an object');
  lines[0] = JSON.stringify({ ...(header as Record<string, unknown>), cwd: PREFIX_SESSION_CWD });
  return lines.join('\n');
}

/** Write a recorded corpus as a `Dataset`-format manifest beside its source directory. */
export async function writePrefixCorpus(root: string, name: string, cases: readonly PrefixRecordedCase[]): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  for (const entry of cases) await writeFile(join(root, name, entry.inputs.prefix.file), entry.sourceText, 'utf8');
  await writeFile(join(root, `${name}.json`), `${JSON.stringify(manifestOf(name, cases), null, 2)}\n`, 'utf8');
}

function manifestOf(name: string, cases: readonly PrefixRecordedCase[]): Record<string, unknown> {
  return { name, cases: cases.map((entry) => ({ name: entry.name, inputs: entry.inputs, metadata: entry.metadata })) };
}

/** Refuse to freeze bytes that carry the credential value a binding was read with. */
export function assertNoCredentialMaterial(text: string, credentials: readonly string[]): void {
  for (const credential of credentials) {
    if (credential !== '' && text.includes(credential)) throw new Error('refusing to freeze a source containing a credential value');
  }
}

function allow(_id: string, context: Context): Promise<void> {
  context.abortSignal?.throwIfAborted();
  return Promise.resolve();
}
