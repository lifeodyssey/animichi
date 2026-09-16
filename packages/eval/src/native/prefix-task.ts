/**
 * One model-backed attempt that resumes a recorded prefix (#1558).
 *
 * The production harness runs on a tree fork of the case's frozen source inside
 * a scratch JSONL repository, so the suffix sees the recorded conversation, the
 * recorded application scalars and the recorded durable references. The
 * attempt owns its repository and closes it (and the harness) on success,
 * failure or cancellation; `Dataset.evaluate` owns repetition, exactly as in
 * `in-process-task.ts`.
 *
 * The observations are the native ones: `observeAttempt` records every
 * `after_tool` invocation as the `pi.after_tool` attribute, which is what
 * `ExpectedActionPass` judges `expected_next_action` from.
 */
import {
  getOrThrow, type Context, type LaneSnapshot, type Session,
} from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, withoutAbortSignal } from '@earendil-works/chord/context';
import { createPilgrimageHarness } from '@animichi/agent/harness';
import { NATIVE_AGENT_OPTIONS } from '@animichi/agent';
import type { createCatalogClient } from '@animichi/agent/tools';
import { observeAttempt } from './attempt-observations.ts';
import type { LoadedPrefixCorpus, PrefixCase } from './prefix-corpus.ts';
import { openPrefixReplay } from './prefix-replay.ts';

type HarnessOptions = Parameters<typeof createPilgrimageHarness>[0];

/** The production composition one prefix attempt runs on. */
export interface PrefixAttemptPorts {
  readonly models: HarnessOptions['models'];
  readonly model: HarnessOptions['model'];
  readonly catalog: ReturnType<typeof createCatalogClient>;
}

/** Run the production harness on a tree fork of the case's recorded prefix. */
export async function prefixTask(
  entry: PrefixCase, corpus: LoadedPrefixCorpus, ports: PrefixAttemptPorts, context: Context = BACKGROUND_CONTEXT,
): Promise<LaneSnapshot> {
  const replay = await openPrefixReplay(corpus, context);
  try {
    const source = await replay.openSource(entry, context);
    const fork = await replay.forkTree(source, context);
    try {
      return await promptFork(fork, entry, ports, context);
    } finally {
      await fork.close(withoutAbortSignal(context));
      await source.session.close(withoutAbortSignal(context));
    }
  } finally {
    await replay.close(withoutAbortSignal(context));
  }
}

async function promptFork(fork: Session, entry: PrefixCase, ports: PrefixAttemptPorts, context: Context): Promise<LaneSnapshot> {
  const options: HarnessOptions = {
    ...NATIVE_AGENT_OPTIONS, session: fork, models: ports.models, model: ports.model,
    toolContext: { session: fork, branch: 'main', locale: entry.inputs.locale, catalog: ports.catalog,
      assertAuthorized: allow, reserveToolUsage: allow },
  };
  const { harness } = await createPilgrimageHarness(options, context);
  try {
    observeAttempt(harness);
    return await promptLane(harness, entry, context);
  } finally {
    await harness.close(withoutAbortSignal(context));
  }
}

async function promptLane(
  harness: Awaited<ReturnType<typeof createPilgrimageHarness>>['harness'], entry: PrefixCase, context: Context,
): Promise<LaneSnapshot> {
  const lane = await harness.lane('main', context);
  getOrThrow(await lane.prompt(entry.inputs.prompt, undefined, context));
  const watch = await lane.watch(withoutAbortSignal(context));
  watch.unsubscribe();
  return watch.snapshot;
}

function allow(_id: string, context: Context): Promise<void> {
  context.abortSignal?.throwIfAborted();
  return Promise.resolve();
}
