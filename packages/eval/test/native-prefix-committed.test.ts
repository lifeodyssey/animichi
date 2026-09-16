import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { loadPrefixCorpus, PREFIX_CORPUS_ROOT, type LoadedPrefixCorpus } from '../src/native/prefix-corpus.ts';
import { installedPiAgentVersion } from '../src/pins.ts';
import { productionToolNames, promptIdentity } from '../src/native/prefix-cases.ts';
import { assertCanonicalIdentifiers, assertNoWallClockReadings } from '../src/native/prefix-canonical.ts';
import { readCaptureConfig, recordCapture } from '../scripts/record-captures.ts';
import {
  openPrefixReplay, pendingSelectionDifferences, readSessionState, resolveRecordedReferences,
  stateDifferences, type PrefixReplay,
} from '../src/native/prefix-replay.ts';

/**
 * The committed corpus is the artifact a reader forks; these tests load the
 * frozen bytes from the package rather than a freshly recorded copy, so a
 * corpus that cannot be replayed as committed fails here.
 */
async function withCommitted(run: (replay: PrefixReplay, corpus: LoadedPrefixCorpus) => Promise<void>): Promise<void> {
  const corpus = await loadPrefixCorpus('phase1c_selection_v1');
  const replay = await openPrefixReplay(corpus, BACKGROUND_CONTEXT);
  try {
    await run(replay, corpus);
  } finally {
    await replay.close(BACKGROUND_CONTEXT);
  }
}

void test('the committed corpus carries the production prompt, tool and SDK identity for every case', async () => {
  await withCommitted((_replay, corpus) => {
    assert.equal(corpus.cases.length, 5);
    for (const entry of corpus.cases) {
      const recording = entry.metadata.recording;
      assert.deepEqual([recording.sdk, recording.prompt, recording.tools, recording.catalog],
        [installedPiAgentVersion(), promptIdentity(), productionToolNames(), 'deterministic-case-fixture']);
      assert.match(recording.commit, /^[0-9a-f]{40}$/);
      assert.equal(recording.boundary, entry.inputs.prefix.boundary);
    }
    return Promise.resolve();
  });
});

void test('every committed frozen source reopens, forks and keeps its recorded boundary state', async () => {
  await withCommitted(async (replay, corpus) => {
    for (const entry of corpus.cases) {
      const state = entry.metadata.prefix_state;
      const source = await replay.openSource(entry, BACKGROUND_CONTEXT);
      const fork = await replay.forkTree(source, BACKGROUND_CONTEXT, `${entry.name}-committed`);
      try {
        const sourceState = await readSessionState(source.session, state, BACKGROUND_CONTEXT);
        assert.deepEqual(stateDifferences(sourceState, await readSessionState(fork, state, BACKGROUND_CONTEXT)), []);
        assert.deepEqual(pendingSelectionDifferences(sourceState.entries, state), []);
        assert.deepEqual(await resolveRecordedReferences(fork, state, BACKGROUND_CONTEXT),
          await resolveRecordedReferences(source.session, state, BACKGROUND_CONTEXT));
      } finally {
        await fork.close(BACKGROUND_CONTEXT);
        await source.session.close(BACKGROUND_CONTEXT);
      }
    }
  });
});

void test('the committed corpus carries placeholders, never a session identifier or a clock reading', async () => {
  const corpus = await loadPrefixCorpus('phase1c_selection_v1');
  for (const entry of corpus.cases) {
    const text = await readFile(entry.sourcePath, 'utf8');
    assert.doesNotThrow(() => { assertCanonicalIdentifiers(text); });
    assert.doesNotThrow(() => { assertNoWallClockReadings(text); });
    assert.match(entry.metadata.prefix_state.entry_id, /^entry-\d{4}$/u);
    assert.match(entry.metadata.prefix_state.references[0]?.entry_id ?? '', /^entry-\d{4}$/u);
  }
});

void test('a deterministic re-record rewrites the committed corpus byte for byte', async () => {
  const committed = JSON.parse(await readFile(join(PREFIX_CORPUS_ROOT, 'phase1c_selection_v1.json'), 'utf8')) as CommittedManifest;
  const root = await mkdtemp(join(tmpdir(), 'prefix-rerecord-'));
  try {
    const config = readCaptureConfig({ EVAL_RECORD_MODE: 'deterministic', EVAL_DATASET: 'phase1c_selection_v1',
      EVAL_COMMIT: committedCommit(committed), EVAL_CAPTURE_OUT: root });
    await recordCapture(config, {});
    assert.equal(await readFile(join(root, 'phase1c_selection_v1.json'), 'utf8'),
      await readFile(join(PREFIX_CORPUS_ROOT, 'phase1c_selection_v1.json'), 'utf8'));
    for (const source of committed.cases.map((entry) => entry.inputs.prefix.file)) {
      assert.equal(await readFile(join(root, 'phase1c_selection_v1', source), 'utf8'),
        await readFile(join(PREFIX_CORPUS_ROOT, 'phase1c_selection_v1', source), 'utf8'), source);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

interface CommittedManifest {
  readonly cases: readonly { readonly inputs: { readonly prefix: { readonly file: string } };
    readonly metadata: { readonly recording: { readonly commit: string } } }[];
}

/** Re-record at the commit the committed corpus names, so only real drift can differ. */
function committedCommit(manifest: CommittedManifest): string {
  const commit = manifest.cases[0]?.metadata.recording.commit;
  if (commit === undefined) throw new Error('the committed corpus names no tested commit');
  return commit;
}
