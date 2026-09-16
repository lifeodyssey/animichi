import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCanonicalIdentifiers, assertNoWallClockReadings, canonicalizeSessionText, canonicalRecordedState,
} from '../src/native/prefix-canonical.ts';
import type { PrefixState } from '../src/native/prefix-corpus.ts';

const ENTRY = '01a0a88a-538a-7537-9cb2-41c54bea4f02';
const OPERATION = '01a0a88a-5385-7537-9cb2-41bd618825f4';
const USAGE = '01a0a88a-538e-7537-9cb2-41ca88a255e4';
const CALL = 'tool:1789534032673:bwk3g15hgv';
const READING = 1789534032781;

interface MintedIds {
  readonly entry: string;
  readonly operation: string;
  readonly step: string;
  readonly usage: string;
  readonly call: string;
  readonly reading: number;
}

const MINTED: MintedIds = { entry: ENTRY, operation: OPERATION, step: '01a0a88a-538d-7537-9cb2-41c65aed4f0e',
  usage: USAGE, call: CALL, reading: READING };

/** A text is one JSON document per line, exactly as the format-4 session writer committed it. */
function sessionText(...documents: readonly unknown[]): string {
  return `${documents.map((document) => JSON.stringify(document)).join('\n')}\n`;
}

/** A minimal recorded session: a header, a tool call, its result, the operation's records, one usage row. */
function recordedSession(ids: MintedIds): string {
  return sessionText(
    { kind: 'header', v: 4, id: 'case', storageVersion: 1, createdAt: ids.reading, cwd: 'animichi-eval-prefix' },
    [{ kind: 'entry', id: ids.entry, parentId: null, type: 'message', message: { role: 'assistant',
      content: [{ type: 'toolCall', id: ids.call, name: 'resolve_anime', arguments: { title: 'Sound Euphonium' } }],
      api: 'faux', provider: 'faux', model: 'faux-model', timestamp: ids.reading }, seq: 5, timestamp: 0 }],
    { kind: 'value', op: 'set', seq: 6, namespace: 'pi.pending.entry', key: ids.entry, value: { type: 'message',
      payload: { role: 'toolResult', toolCallId: ids.call, toolName: 'search_bangumi',
        content: [{ type: 'text', text: JSON.stringify({ outcome: 'ok', result_ref: ids.entry }) }], timestamp: ids.reading } } },
    { kind: 'value', op: 'set', seq: 7, namespace: 'pi.op.meta', key: ids.operation,
      value: { operationId: ids.operation, lane: 'main', startedAt: ids.reading, generationContext: { stepId: ids.step },
        intent: { kind: 'run', promptEntryIds: [ids.entry] } } },
    { kind: 'value', op: 'set', seq: 8, namespace: 'pi.branch.tip', key: 'main', value: ids.entry },
    { kind: 'value', op: 'delete', seq: 9, namespace: 'pi.op.tool_args', key: `${ids.operation}:${ids.step}:0`,
      value: { search_result_ref: ids.entry } },
    { kind: 'usage', id: ids.usage, usage: { input: 1, cost: { total: 0 } }, entryId: ids.entry, adjustment: false, seq: 10 },
  );
}

const STATE: PrefixState = {
  kind: 'pending_selection', reason: 'anime_ambiguity', clarification_id: 7, entry_id: ENTRY,
  candidates: [{ id: '115908', title: 'Sound Euphonium' }],
  references: [{ kind: 'search_result', entry_id: ENTRY, tool: 'search_bangumi' }],
  scalars: [{ namespace: 'animichi.operation.input', key: 'case', value: { locale: 'en' } }],
};

void test('every identifier family becomes a readable placeholder and every classified clock the epoch', () => {
  const { text, ids } = canonicalizeSessionText(recordedSession(MINTED));
  assert.deepEqual([...ids], [[ENTRY, 'entry-0001'], [CALL, 'call-0001'], [OPERATION, 'op-0001'],
    [MINTED.step, 'step-0001'], [USAGE, 'usage-0001']]);
  assert.equal(text.includes('"id":"entry-0001"'), true);
  assert.equal(text.includes('"value":"entry-0001"'), true);
  assert.equal(text.includes('"key":"op-0001:step-0001:0"'), true);
  assert.equal(text.includes('"key":"op-0001"'), true);
  assert.equal(text.includes('"search_result_ref":"entry-0001"'), true);
  assert.equal(text.includes('result_ref\\":\\"entry-0001'), true);
  assert.equal(text.includes('"id":"case"'), true);
  assert.equal(text.includes('animichi-eval-prefix'), true);
  assert.equal(text.includes('"timestamp":0'), true);
  assert.equal(text.includes('"startedAt":0'), true);
  assert.equal(text.includes('"createdAt":0'), true);
  assert.deepEqual(text.split('\n').map((line) => line === '' ? 'end' : line.startsWith('[{') ? 'batch' : 'write'),
    ['write', 'batch', 'write', 'write', 'write', 'write', 'write', 'end']);
  assert.doesNotThrow(() => { assertCanonicalIdentifiers(text); });
  assert.doesNotThrow(() => { assertNoWallClockReadings(text); });
});

void test('two recordings of the same script canonicalize to the same bytes', () => {
  const first = canonicalizeSessionText(recordedSession(MINTED));
  const second = canonicalizeSessionText(recordedSession({ entry: '01a0a88a-5364-7537-9cb2-417ee976c236',
    operation: '01a0a88a-5366-7537-9cb2-418982c99dd5', step: '01a0a88a-5367-7537-9cb2-41826c5a456d',
    usage: '01a0a88a-536b-7537-9cb2-4190fcc2a6a5', call: 'tool:1789534099123:zz1q2w3e4r', reading: 1789534099123 }));
  assert.equal(second.text, first.text);
  assert.notDeepEqual([...second.ids], [...first.ids]);
});

void test('an identifier the recorder does not classify is refused, not rewritten', () => {
  const unknownField = sessionText({ kind: 'entry', id: ENTRY, parentId: null, type: 'message',
    message: { role: 'toolResult', toolCallId: CALL, content: [{ type: 'text', text: 'ok' }],
      details: { work_id: OPERATION }, timestamp: READING }, seq: 5, timestamp: 0 });
  assert.throws(() => canonicalizeSessionText(unknownField), /canonicalizes only the identifiers it classifies/);
  const payloadId = sessionText({ kind: 'entry', id: ENTRY, parentId: null, type: 'message',
    message: { role: 'toolResult', toolCallId: CALL, content: [{ type: 'text', id: OPERATION, text: 'ok' }], timestamp: READING },
    seq: 5, timestamp: 0 });
  assert.throws(() => canonicalizeSessionText(payloadId), /canonicalizes only the identifiers it classifies/);
});

void test('one token in two identifier families is refused', () => {
  const twice = sessionText(
    { kind: 'value', op: 'set', seq: 7, namespace: 'pi.op.meta', key: OPERATION,
      value: { operationId: OPERATION, lane: 'main', intent: { kind: 'run', promptEntryIds: [] } } },
    { kind: 'value', op: 'set', seq: 8, namespace: 'pi.branch.tip', key: 'main', value: OPERATION },
  );
  assert.throws(() => canonicalizeSessionText(twice), /claimed as both op and entry/);
});

void test('a clock reading the tables do not name is refused', () => {
  const payloadClock = sessionText({ kind: 'entry', id: ENTRY, parentId: null, type: 'message',
    message: { role: 'toolResult', toolCallId: CALL, content: [{ type: 'text', text: 'ok' }],
      details: { timestamp: READING }, timestamp: READING }, seq: 5, timestamp: 0 });
  assert.throws(() => canonicalizeSessionText(payloadClock), /pins only the clocks it classifies/);
  const unnamedClock = sessionText({ kind: 'value', op: 'set', seq: 1, namespace: 'animichi.operation.input',
    key: 'case', value: { locale: 'en', observed_at: READING } });
  assert.throws(() => canonicalizeSessionText(unnamedClock), /carries a wall-clock reading/);
});

void test('the guards refuse identifiers and readings wherever they survive', () => {
  assert.throws(() => { assertCanonicalIdentifiers(`{"key":"${ENTRY}"}`); }, /carries a recorded identifier/);
  assert.throws(() => { assertCanonicalIdentifiers(`{"id":"${CALL}"}`); }, /carries a recorded identifier/);
  assert.throws(() => { assertNoWallClockReadings(`{"at":${String(READING)}}`); }, /carries a wall-clock reading/);
  assert.throws(() => { assertNoWallClockReadings('{"at":"2026-09-16T04:47:12.675Z"}'); }, /carries a wall-clock reading/);
  assert.doesNotThrow(() => { assertCanonicalIdentifiers('{"key":"op-0001:entry-0002:0","id":"case"}'); });
});

void test('a line the session writer did not serialize itself is refused', () => {
  assert.throws(() => canonicalizeSessionText('{"kind": "entry"}\n'), /did not serialize itself/);
});

void test('the boundary state maps through the same identifiers and refuses an unmapped one', () => {
  const { ids } = canonicalizeSessionText(recordedSession(MINTED));
  const canonical = canonicalRecordedState(STATE, ids);
  assert.equal(canonical.entry_id, 'entry-0001');
  assert.deepEqual(canonical.references, [{ kind: 'search_result', entry_id: 'entry-0001', tool: 'search_bangumi' }]);
  assert.deepEqual(canonical.candidates, STATE.candidates);
  assert.throws(() => canonicalRecordedState(STATE, new Map()), /which the frozen bytes do not carry/);
});
