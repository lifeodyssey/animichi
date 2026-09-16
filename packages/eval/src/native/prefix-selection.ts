/**
 * The deterministic selection a frozen prefix boundary is evaluated with
 * (#1558).
 *
 * Production runs this work in the host, outside the model loop: the partner
 * clicks a candidate and `executeSelection` resolves it, then one correlated
 * `animichi.selection` entry records the result. This replay does exactly that
 * on a tree fork of the recorded boundary — no model call, no gateway, no
 * session database — and reports the verified candidate, revision and
 * reference state next to the selection it produced.
 *
 * The report is explicitly a deterministic replay, not a model-backed eval:
 * `model_calls` is zero and each case is judged by the `expected_next_action`
 * constraints the corpus declares.
 */
import type { Context, Entry } from '@earendil-works/pi-agent-core';
import { executeSelection, SELECTION_ENTRY, selectionEntryData } from '@animichi/agent/selection';
import { projectPilgrimage } from '@animichi/agent/tools';
import type { createCatalogClient } from '@animichi/agent/tools';
import { actionViolations, domainEntriesFrom, type ActionSubject } from './expected-action.ts';
import { loadPrefixCorpus, type LoadedPrefixCorpus, type PrefixCase } from './prefix-corpus.ts';
import {
  openPrefixReplay, pendingSelectionDifferences, readSessionState, resolveRecordedReferences,
  stateDifferences, type PrefixReplay,
} from './prefix-replay.ts';

type ReplaySession = Awaited<ReturnType<PrefixReplay['openSource']>>['session'];
type SelectionResult = Awaited<ReturnType<typeof executeSelection>>;

export interface SelectionReplayPorts {
  readonly catalog: ReturnType<typeof createCatalogClient>;
  readonly commit: string;
}

export interface SelectionCaseReport {
  readonly name: string;
  readonly status: 'pass' | 'fail';
  readonly clarification_id: number;
  readonly candidates: readonly unknown[];
  readonly reference: { readonly entry_id: string; readonly tool: string };
  readonly selection_status: string | null;
  readonly omitted: readonly string[];
  readonly row_count: number;
  readonly faults: readonly string[];
}

export interface SelectionReplayReport {
  readonly kind: 'deterministic-selection-replay';
  readonly dataset: string;
  readonly model_calls: 0;
  readonly commit: string;
  readonly sdk: string;
  readonly cases: readonly SelectionCaseReport[];
}

/** Replay every case's deterministic selection from its own frozen fork. */
export async function replaySelection(
  replay: PrefixReplay, corpus: LoadedPrefixCorpus, ports: SelectionReplayPorts, context: Context,
): Promise<SelectionReplayReport> {
  const cases: SelectionCaseReport[] = [];
  for (const entry of corpus.cases) cases.push(await replayCase(replay, entry, ports, context));
  return { kind: 'deterministic-selection-replay', dataset: corpus.name, model_calls: 0,
    commit: ports.commit, sdk: corpus.cases[0]?.metadata.recording.sdk ?? '', cases };
}

/** Load the named corpus and replay it; the scratch repository is always closed. */
export async function runPrefixSelection(
  corpusName: string, ports: SelectionReplayPorts, context: Context,
): Promise<SelectionReplayReport> {
  const corpus = await loadPrefixCorpus(corpusName);
  const replay = await openPrefixReplay(corpus, context);
  try {
    return await replaySelection(replay, corpus, ports, context);
  } finally {
    await replay.close(context);
  }
}

/** Every fault in a replay report, prefixed by its case. */
export function reportFaults(replay: SelectionReplayReport): readonly string[] {
  return replay.cases.flatMap((entry) => entry.faults.map((fault) => `${entry.name}: ${fault}`));
}

async function replayCase(
  replay: PrefixReplay, entry: PrefixCase, ports: SelectionReplayPorts, context: Context,
): Promise<SelectionCaseReport> {
  const source = await replay.openSource(entry, context);
  const fork = await replay.forkTree(source, context, `${entry.name}-fork`);
  try {
    return await selectedFromFork(entry, source.session, fork, ports, context);
  } catch (error) {
    return failedCase(entry, error);
  } finally {
    await fork.close(context);
    await source.session.close(context);
  }
}

async function selectedFromFork(
  entry: PrefixCase, source: ReplaySession, fork: ReplaySession, ports: SelectionReplayPorts, context: Context,
): Promise<SelectionCaseReport> {
  const faults = await forkFaults(entry, source, fork, context);
  const result = await runSelection(entry, fork, ports, context);
  return selectionReport(entry, result, [...faults, ...await actionFaults(entry, fork, context)]);
}

/** The production deterministic action: resolve the offered candidates, then record the entry. */
async function runSelection(entry: PrefixCase, fork: ReplaySession, ports: SelectionReplayPorts, context: Context): Promise<SelectionResult> {
  const entries = await fork.findEntries(undefined, context);
  const pending = projectPilgrimage(entries).clarification;
  if (pending === undefined) throw new Error('the fork carried no pending selection');
  const candidateIds = [...entry.inputs.selection?.candidateIds ?? []];
  const result = await executeSelection({ of: 'candidates', candidateIds, clarificationId: pending.id, locale: entry.inputs.locale },
    entries, ports.catalog, context);
  await recordSelection(entry, fork, result, context);
  return result;
}

/** The host records one correlated custom entry for the deterministic action. */
async function recordSelection(entry: PrefixCase, fork: ReplaySession, result: SelectionResult, context: Context): Promise<void> {
  const branch = await fork.branch('main', context);
  if (branch === undefined) throw new Error('the fork has no main branch to record the selection on');
  await branch.appendCustomEntry(SELECTION_ENTRY, selectionEntryData(entry.name, result), context);
}

/** What the fork got wrong before the action ran: entries, scalars, pending state, references. */
async function forkFaults(entry: PrefixCase, source: ReplaySession, fork: ReplaySession, context: Context): Promise<string[]> {
  const state = entry.metadata.prefix_state;
  const differences = stateDifferences(await readSessionState(source, state, context), await readSessionState(fork, state, context));
  const faults = differences.map((difference) => `fork differs in ${difference}`);
  const pending = pendingSelectionDifferences(await fork.findEntries(undefined, context), state);
  faults.push(...pending.map((difference) => `pending selection differs in ${difference}`));
  const [before, after] = await Promise.all([resolveRecordedReferences(source, state, context), resolveRecordedReferences(fork, state, context)]);
  if (JSON.stringify(before) !== JSON.stringify(after)) faults.push('the durable reference resolves differently in the fork');
  return faults;
}

async function actionFaults(entry: PrefixCase, fork: ReplaySession, context: Context): Promise<readonly string[]> {
  const entries: readonly Entry[] = await fork.findEntries(undefined, context);
  const subjects: readonly ActionSubject[] = domainEntriesFrom(entries);
  return actionViolations(entry.metadata.expected_next_action, subjects);
}

function selectionReport(entry: PrefixCase, result: SelectionResult, faults: readonly string[]): SelectionCaseReport {
  const violations = [...faults, ...expectationFaults(entry, result)];
  return { ...baseReport(entry, violations), selection_status: result.status, omitted: result.omitted, row_count: result.rows.length };
}

function expectationFaults(entry: PrefixCase, result: SelectionResult): readonly string[] {
  const expected = entry.metadata.expected_selection;
  if (expected === undefined) return [];
  const faults: string[] = [];
  if (result.status !== expected.status) faults.push(`expected selection status ${expected.status} but got ${result.status}`);
  if (expected.expect_nonempty !== (result.rows.length > 0)) faults.push('the selection result does not match the expected non-emptiness');
  return faults;
}

function baseReport(entry: PrefixCase, faults: readonly string[]): SelectionCaseReport {
  const state = entry.metadata.prefix_state;
  return { name: entry.name, status: faults.length === 0 ? 'pass' : 'fail', clarification_id: state.clarification_id,
    candidates: state.candidates, reference: { entry_id: state.references[0]?.entry_id ?? '', tool: state.references[0]?.tool ?? '' },
    selection_status: null, omitted: [], row_count: 0, faults };
}

function failedCase(entry: PrefixCase, error: unknown): SelectionCaseReport {
  return baseReport(entry, [error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)]);
}
