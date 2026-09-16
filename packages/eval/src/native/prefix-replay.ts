/**
 * Replaying a recorded prefix and forking it inside one native JSONL repository
 * (#1558).
 *
 * The frozen bytes are copied into a scratch repository and never opened in
 * place, so repeated and concurrent forks cannot mutate the corpus. A tree fork
 * is the supported prefix path; `forkBranch` exists so the degradation a branch
 * fork causes is a checked difference rather than a silent one.
 *
 * Equality is asserted on native state: entry ids and content, the scalar
 * payloads the case declares it needs, durable search references resolved
 * through `getEntry`, and the pending selection the boundary froze.
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Context, Entry, Session } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { JsonlSessionRepo, value, type JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import { withoutAbortSignal } from '@earendil-works/chord/context';
import { projectPilgrimage, readSearchResult } from '@animichi/agent/tools';
import type { LoadedPrefixCorpus, PrefixCase, PrefixState } from './prefix-corpus.ts';

const SOURCE_DIRECTORY = 'sources';

export interface ReplaySession {
  readonly metadata: JsonlSessionMetadata;
  readonly session: Session<JsonlSessionMetadata>;
}

/** One scratch repository holding every frozen source of a corpus. */
export interface PrefixReplay {
  readonly root: string;
  readonly repository: JsonlSessionRepo;
  openSource(source: PrefixCase, context: Context): Promise<ReplaySession>;
  forkTree(source: ReplaySession, context: Context, id?: string): Promise<Session<JsonlSessionMetadata>>;
  /** The unsupported scope, kept only so its degradation is a checked difference. */
  forkBranch(source: ReplaySession, context: Context, id?: string): Promise<Session<JsonlSessionMetadata>>;
  close(context: Context): Promise<void>;
}

/** Copy a corpus into a scratch repository; nothing here writes to the corpus. */
export async function openPrefixReplay(corpus: LoadedPrefixCorpus, context: Context): Promise<PrefixReplay> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-replay-'));
  const repository = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
  try {
    await copySources(corpus, join(root, SOURCE_DIRECTORY));
    await assertSourcesOpenable(repository, corpus, context);
  } catch (error) {
    await closeReplay(root, repository, context);
    throw error;
  }
  return replayOf(root, repository);
}

async function copySources(corpus: LoadedPrefixCorpus, sources: string): Promise<void> {
  await mkdir(sources, { recursive: true });
  for (const entry of corpus.cases) await copyFile(entry.sourcePath, join(sources, entry.inputs.prefix.file));
}

function replayOf(root: string, repository: JsonlSessionRepo): PrefixReplay {
  return {
    root,
    repository,
    openSource: (source, context) => openSource(repository, source, context),
    forkTree: (source, context, id) => fork(repository, source, treeOptions(id), context),
    forkBranch: (source, context, id) => fork(repository, source, branchOptions(id), context),
    close: (context) => closeReplay(root, repository, context),
  };
}

function treeOptions(id: string | undefined) {
  return { scope: 'tree' as const, ...(id === undefined ? {} : { id }) };
}

/** The unsupported scope, kept only so its degradation is a checked difference. */
function branchOptions(id: string | undefined) {
  return { scope: 'branch' as const, branch: 'main', ...(id === undefined ? {} : { id }) };
}

async function closeReplay(root: string, repository: JsonlSessionRepo, context: Context): Promise<void> {
  await repository.close(withoutAbortSignal(context));
  await rm(root, { recursive: true, force: true });
}

/** Fail before any attempt if a frozen source cannot be opened by the real repository. */
async function assertSourcesOpenable(repository: JsonlSessionRepo, corpus: LoadedPrefixCorpus, context: Context): Promise<void> {
  for (const source of corpus.cases) {
    const opened = await openSource(repository, source, context);
    await opened.session.close(context);
  }
}

async function openSource(repository: JsonlSessionRepo, source: PrefixCase, context: Context): Promise<ReplaySession> {
  const metadata = (await repository.list(undefined, context)).find((candidate) => candidate.id === source.inputs.prefix.session_id);
  if (metadata === undefined) throw new Error(`frozen source ${source.name}: no session ${source.inputs.prefix.session_id} in the replay repository`);
  return { metadata, session: await repository.open(metadata, context) };
}

async function fork(
  repository: JsonlSessionRepo, source: ReplaySession,
  options: Parameters<JsonlSessionRepo['fork']>[1], context: Context,
): Promise<Session<JsonlSessionMetadata>> {
  return repository.fork(source.metadata, options, context);
}

/** Everything a fork must carry: the entries and the scalar payloads the case declares. */
export interface SessionState {
  readonly entries: readonly Entry[];
  readonly scalars: readonly { readonly namespace: string; readonly key: string; readonly value: unknown }[];
}

export async function readSessionState(session: Session, state: PrefixState, context: Context): Promise<SessionState> {
  const entries = await session.findEntries(undefined, context);
  const scalars = [];
  for (const scalar of state.scalars) {
    scalars.push({ namespace: scalar.namespace, key: scalar.key,
      value: (await session.getValue(value(scalar.namespace, scalar.key), context))?.value });
  }
  return { entries, scalars };
}

/** The names of the state a fork failed to carry; empty means equivalent. */
export function stateDifferences(source: SessionState, fork: SessionState): readonly string[] {
  const differences: string[] = [];
  if (!isDeepStrictEqual(source.entries, fork.entries)) differences.push('entries');
  if (!isDeepStrictEqual(source.scalars, fork.scalars)) differences.push('scalars');
  return differences;
}

/** The names of the frozen pending state a session failed to reproduce; empty means equivalent. */
export function pendingSelectionDifferences(entries: readonly Entry[], state: PrefixState): readonly string[] {
  const pending = projectPilgrimage(entries).clarification;
  if (pending === undefined) return ['pending selection'];
  const differences: string[] = [];
  if (pending.reason !== state.reason) differences.push('reason');
  if (pending.id !== state.clarification_id) differences.push('revision');
  if (pending.entryId !== state.entry_id) differences.push('entry');
  if (!isDeepStrictEqual(pending.candidates, state.candidates)) differences.push('candidates');
  return differences;
}

export interface ResolvedReference {
  readonly entryId: string;
  readonly tool: string;
  readonly details: unknown;
}

/**
 * Resolve every recorded reference through the session's own `getEntry` and the
 * production branch-ancestry rule. A reference that does not resolve throws: an
 * unfollowable reference is a broken boundary, never a passing comparison.
 */
export async function resolveRecordedReferences(
  session: Session, state: PrefixState, context: Context, branch = 'main',
): Promise<readonly ResolvedReference[]> {
  const resolved: ResolvedReference[] = [];
  for (const reference of state.references) {
    const entry = await session.getEntry(reference.entry_id, context);
    if (entry === undefined) throw new Error(`recorded reference ${reference.entry_id} does not resolve`);
    const details = await readSearchResult(session, branch, reference.entry_id, context);
    if (details === undefined) throw new Error(`recorded reference ${reference.entry_id} is not a committed search result in ${branch}`);
    resolved.push({ entryId: reference.entry_id, tool: reference.tool, details });
  }
  return resolved;
}
