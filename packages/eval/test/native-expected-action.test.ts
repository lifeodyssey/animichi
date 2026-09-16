import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionViolations, type ActionSubject } from '../src/native/expected-action.ts';
import { ExpectedNextAction } from '../src/native/prefix-corpus.ts';

const SELECTION_ENTRY = 'animichi.selection';

function expected(action: unknown) {
  return ExpectedNextAction.parse(action);
}

function call(tool: string, arguments_: Record<string, unknown>): ActionSubject {
  return { kind: 'model_call', tool, arguments: arguments_ };
}

function selection(request: Record<string, unknown>): ActionSubject {
  return { kind: 'domain_entry', entryType: SELECTION_ENTRY, request };
}

void test('tool "none" passes only when no model call happened and the native domain entry is present', () => {
  const declared = expected({ tool: 'none', domain_entry: SELECTION_ENTRY, arguments: [], forbidden: { tools: [], arguments: [] } });
  assert.deepEqual(actionViolations(declared, [selection({ of: 'candidates', candidateIds: ['115908'] })]), []);
  assert.deepEqual(actionViolations(declared, []), [`tool "none" requires the native domain entry ${SELECTION_ENTRY}`]);
  assert.deepEqual(actionViolations(declared, [call('search_nearby', { location: '宇治' }), selection({})]),
    ['tool "none" forbids model-initiated tool calls but search_nearby was called']);
});

void test('the declared first tool must be the first model-initiated call', () => {
  const declared = expected({ tool: 'search_nearby', arguments: [], forbidden: { tools: [], arguments: [] } });
  assert.deepEqual(actionViolations(declared, [call('search_nearby', { location: '宇治' })]), []);
  assert.deepEqual(actionViolations(declared, []), ['expected tool search_nearby but the suffix made no model-initiated tool call']);
  assert.deepEqual(actionViolations(declared, [call('resolve_anime', { title: 'Uji' })]),
    ['expected tool search_nearby but the first model call was resolve_anime']);
});

void test('a correct tool with the wrong work id, radius or coordinates fails its constraint', () => {
  const workId = expected({ tool: 'search_bangumi', arguments: [{ kind: 'enum', argument: 'bangumi_id', values: ['115908'] }], forbidden: { tools: [], arguments: [] } });
  assert.deepEqual(actionViolations(workId, [call('search_bangumi', { bangumi_id: '115908' })]), []);
  assert.deepEqual(actionViolations(workId, [call('search_bangumi', { bangumi_id: '999001' })]),
    ['argument bangumi_id="999001" must be one of "115908"']);
  const radius = expected({ tool: 'search_nearby', arguments: [{ kind: 'range', argument: 'radius_m', min: 1000, max: 5000 }], forbidden: { tools: [], arguments: [] } });
  assert.deepEqual(actionViolations(radius, [call('search_nearby', { radius_m: 3000 })]), []);
  assert.deepEqual(actionViolations(radius, [call('search_nearby', { radius_m: 50_000 })]),
    ['argument radius_m=50000 must be at most 5000']);
  const bounds = expected({ tool: 'plan_route', arguments: [{ kind: 'bounds', argument: 'origin', min_lat: 34, max_lat: 36, min_lng: 135, max_lng: 136 }], forbidden: { tools: [], arguments: [] } });
  assert.deepEqual(actionViolations(bounds, [call('plan_route', { origin: '34.8843,135.7997' })]), []);
  assert.deepEqual(actionViolations(bounds, [call('plan_route', { origin: { lat: 35.6762, lng: 139.6503 } })]),
    ['argument origin={"lat":35.6762,"lng":139.6503} must be lat 34..36, lng 135..136']);
});

void test('a deterministic action must select only offered candidates and its forbidden tools never appear', () => {
  const declared = expected({ tool: 'none', domain_entry: SELECTION_ENTRY,
    arguments: [{ kind: 'set', argument: 'candidateIds', values: ['115908', '11291'], max_items: 2 }],
    forbidden: { tools: ['respond'], arguments: [{ kind: 'range', argument: 'radius_m', min: 10_000 }] } });
  assert.deepEqual(actionViolations(declared, [selection({ candidateIds: ['115908', '11291'] })]), []);
  assert.deepEqual(actionViolations(declared, [selection({ candidateIds: ['115908', '999001'] })]),
    ['argument candidateIds=["115908","999001"] must be members of "115908", "11291"']);
  assert.deepEqual(actionViolations(declared, [selection({ candidateIds: ['115908', '11291'] }), call('respond', { message: 'done' })]),
    ['tool "none" forbids model-initiated tool calls but respond was called', 'forbidden tool respond was called']);
  assert.deepEqual(actionViolations(declared, [selection({ candidateIds: ['115908'] }), call('search_nearby', { radius_m: 20_000 })]),
    ['tool "none" forbids model-initiated tool calls but search_nearby was called', 'forbidden range(radius_m) was used']);
});
