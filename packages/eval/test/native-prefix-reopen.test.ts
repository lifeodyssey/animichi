import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { value } from '@earendil-works/pi-agent-core/harness/session';
import { pendingSelectionDifferences, readSessionState, stateDifferences } from '../src/native/prefix-replay.ts';
import { canonicalSelectionCases, caseNamed, withRecordedCorpus } from './native-prefix-phase1c.ts';

const CASE = 'D3_multi_success_two';

void test('a frozen source closes, reopens and forks inside one native JSONL repository without reminting', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const state = caseNamed(corpus, CASE).metadata.prefix_state;
    const first = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const before = await readSessionState(first.session, state, BACKGROUND_CONTEXT);
    await first.session.close(BACKGROUND_CONTEXT);
    const reopened = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const after = await readSessionState(reopened.session, state, BACKGROUND_CONTEXT);
    const fork = await replay.forkTree(reopened, BACKGROUND_CONTEXT, 'reopen-fork');
    try {
      assert.deepEqual(stateDifferences(before, after), []);
      assert.deepEqual(stateDifferences(after, await readSessionState(fork, state, BACKGROUND_CONTEXT)), []);
      assert.equal(fork.metadata.parentSessionId, caseNamed(corpus, CASE).inputs.prefix.session_id);
      assert.deepEqual(pendingSelectionDifferences(await fork.findEntries(undefined, BACKGROUND_CONTEXT), state), []);
    } finally {
      await fork.close(BACKGROUND_CONTEXT);
      await reopened.session.close(BACKGROUND_CONTEXT);
    }
  });
});

void test('repeated and concurrent forks are independent destinations of the same source', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const state = caseNamed(corpus, CASE).metadata.prefix_state;
    const source = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const forks = await Promise.all(['a', 'b', 'c', 'd'].map((suffix) => replay.forkTree(source, BACKGROUND_CONTEXT, `concurrent-${suffix}`)));
    try {
      assert.deepEqual(new Set(forks.map((fork) => fork.metadata.id)).size, 4);
      for (const fork of forks) {
        assert.deepEqual(stateDifferences(await readSessionState(source.session, state, BACKGROUND_CONTEXT),
          await readSessionState(fork, state, BACKGROUND_CONTEXT)), []);
      }
      await forks[0]?.setValue(value<string>('animichi.test.destination'), 'only-a', BACKGROUND_CONTEXT);
      const written = forks[0] === undefined ? undefined : await forks[0].getValue(value<string>('animichi.test.destination'), BACKGROUND_CONTEXT);
      const untouched = forks[1] === undefined ? undefined : await forks[1].getValue(value<string>('animichi.test.destination'), BACKGROUND_CONTEXT);
      assert.equal(written?.value, 'only-a');
      assert.equal(untouched, undefined);
      assert.equal(await source.session.getValue(value<string>('animichi.test.destination'), BACKGROUND_CONTEXT), undefined);
    } finally {
      for (const fork of forks) await fork.close(BACKGROUND_CONTEXT);
      await source.session.close(BACKGROUND_CONTEXT);
    }
  });
});

void test('every intended boundary has its own frozen source with the provenance its case records', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const canonical = await canonicalSelectionCases();
    assert.deepEqual(corpus.cases.map((entry) => entry.name), canonical.map((entry) => entry.id));
    for (const entry of corpus.cases) {
      const recording = entry.metadata.recording;
      assert.deepEqual([recording.sdk, recording.model, recording.commit], ['0.85.1', 'faux-model', 'tested-commit']);
      assert.equal(recording.boundary, entry.inputs.prefix.boundary);
      assert.equal(entry.inputs.prefix.session_id, entry.name);
      const source = await replay.openSource(entry, BACKGROUND_CONTEXT);
      try {
        assert.deepEqual(pendingSelectionDifferences(await source.session.findEntries(undefined, BACKGROUND_CONTEXT), entry.metadata.prefix_state), []);
      } finally {
        await source.session.close(BACKGROUND_CONTEXT);
      }
    }
    assert.equal(new Set(corpus.cases.map((entry) => entry.inputs.prefix.session_id)).size, 5);
  });
});
