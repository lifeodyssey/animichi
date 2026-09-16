import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { list } from '@earendil-works/pi-agent-core/harness/session';
import {
  pendingSelectionDifferences, readSessionState, resolveRecordedReferences, stateDifferences,
} from '../src/native/prefix-replay.ts';
import { caseNamed, withRecordedCorpus } from './native-prefix-phase1c.ts';

const CASE = 'D3_multi_success_two';

void test('a tree fork carries the recorded entries, required scalars, references and pending selection', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const source = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const state = caseNamed(corpus, CASE).metadata.prefix_state;
    const fork = await replay.forkTree(source, BACKGROUND_CONTEXT, 'tree-fork');
    try {
      const sourceState = await readSessionState(source.session, state, BACKGROUND_CONTEXT);
      const forkState = await readSessionState(fork, state, BACKGROUND_CONTEXT);
      assert.deepEqual(stateDifferences(sourceState, forkState), []);
      assert.ok(sourceState.entries.length > 4);
      assert.deepEqual(forkState.scalars, [{ namespace: 'animichi.operation.input', key: CASE, value: { locale: 'en' } }]);
      assert.deepEqual(pendingSelectionDifferences(sourceState.entries, state), []);
      assert.deepEqual(pendingSelectionDifferences(forkState.entries, state), []);
      assert.deepEqual(await resolveRecordedReferences(source.session, state, BACKGROUND_CONTEXT),
        await resolveRecordedReferences(fork, state, BACKGROUND_CONTEXT));
      const reference = state.references[0];
      assert.ok(reference);
      assert.deepEqual(await fork.getEntry(reference.entry_id, BACKGROUND_CONTEXT),
        await source.session.getEntry(reference.entry_id, BACKGROUND_CONTEXT));
    } finally {
      await fork.close(BACKGROUND_CONTEXT);
      await source.session.close(BACKGROUND_CONTEXT);
    }
  });
});

void test('a branch-scope fork silently drops the required application scalar and the check catches it', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const source = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const state = caseNamed(corpus, CASE).metadata.prefix_state;
    const branch = await replay.forkBranch(source, BACKGROUND_CONTEXT, 'branch-fork');
    try {
      const sourceState = await readSessionState(source.session, state, BACKGROUND_CONTEXT);
      const branchState = await readSessionState(branch, state, BACKGROUND_CONTEXT);
      assert.deepEqual(stateDifferences(sourceState, branchState), ['scalars']);
      assert.deepEqual(branchState.scalars, [{ namespace: 'animichi.operation.input', key: CASE, value: undefined }]);
    } finally {
      await branch.close(BACKGROUND_CONTEXT);
      await source.session.close(BACKGROUND_CONTEXT);
    }
  });
});

void test('the 0.85.1 tree fork does not copy list elements, and no copier pretends otherwise', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const source = await replay.openSource(caseNamed(corpus, CASE), BACKGROUND_CONTEXT);
    const address = list<string>('animichi.test.list');
    await source.session.appendList(address, 'recorded list element', BACKGROUND_CONTEXT);
    const fork = await replay.forkTree(source, BACKGROUND_CONTEXT, 'list-fork');
    try {
      assert.deepEqual((await source.session.readList(address, undefined, BACKGROUND_CONTEXT)).map((entry) => entry.value),
        ['recorded list element']);
      assert.deepEqual(await fork.readList(address, undefined, BACKGROUND_CONTEXT), []);
    } finally {
      await fork.close(BACKGROUND_CONTEXT);
      await source.session.close(BACKGROUND_CONTEXT);
    }
  });
});
