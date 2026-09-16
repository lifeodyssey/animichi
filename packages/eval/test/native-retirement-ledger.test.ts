import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RETIREMENT_RULES,
  familyOf,
  validateRetirementLedger,
  type RetirementCandidate,
  type RetirementEntry,
} from '../src/native/retirement-ledger.ts';

const VACUOUS: RetirementEntry = {
  caseId: 'A1_ja_001',
  rule: 'vacuous-perfect-success',
  reason: 'the do-nothing trajectory scored full on every carried metric',
  evidence: {
    rule: 'vacuous-perfect-success',
    carriedMetrics: ['trajectory_match', 'tool_correctness'],
    doNothingScores: { trajectory_match: 1, tool_correctness: 1 },
    fullScores: { trajectory_match: 1, tool_correctness: 1 },
  },
  archive: { inputs: { prompt: 'x', locale: 'ja' }, expectedOutput: null, metadata: {}, evaluators: [] },
};

function candidateOf(id: string, name: string, locale: string, stages: readonly string[]): RetirementCandidate {
  return { id, name, locale, acceptableStages: stages };
}

function corpus(): readonly RetirementCandidate[] {
  return [
    candidateOf('A1_ja_001', 'A1_ja_001', 'ja', ['search_bangumi']),
    candidateOf('A1_ja_002', 'A1_ja_002', 'ja', ['search_bangumi']),
    candidateOf('A1_ja_003', 'A1_ja_003', 'ja', ['search_bangumi']),
    candidateOf('A1_zh_001', 'A1_zh_001', 'zh', ['clarify']),
  ];
}

/** The validated ledger, so an assertion callback is a value-returning call. */
function check(
  entries: readonly RetirementEntry[],
  candidates: readonly RetirementCandidate[] = corpus(),
): readonly RetirementEntry[] {
  validateRetirementLedger(entries, candidates);
  return entries;
}

function archive(): RetirementEntry['archive'] {
  return { inputs: {}, expectedOutput: null, metadata: {}, evaluators: [] };
}

void test('family normalization strips the trailing index and every locale segment', () => {
  assert.equal(familyOf('A1_ja_001'), 'A1');
  assert.equal(familyOf('HO_loc_zh_jaq_001'), 'HO_loc');
  assert.equal(familyOf('HO_tr_romaji_001'), 'HO_tr_romaji');
  assert.equal(familyOf('G1_001'), 'G1');
  assert.equal(familyOf('D3_multi_success_two'), 'D3_multi_success_two');
});

void test('the four rules are declared, and divergence is investigation-only', () => {
  assert.deepEqual([...RETIREMENT_RULES],
    ['vacuous-perfect-success', 'unmeasured-criterion', 'redundancy', 'single-run-divergence']);
});

void test('a vacuous perfect success retires with its do-nothing evidence', () => {
  assert.doesNotThrow(() => check([VACUOUS]));
});

void test('a vacuous entry whose do-nothing evidence is not full is refused', () => {
  const weak: RetirementEntry = { ...VACUOUS, evidence: {
    rule: 'vacuous-perfect-success',
    carriedMetrics: ['trajectory_match', 'tool_correctness'],
    doNothingScores: { trajectory_match: 1, tool_correctness: 0.5 },
    fullScores: { trajectory_match: 1, tool_correctness: 1 },
  } };
  assert.throws(() => check([weak]), /scored full/);
});

void test('an unmeasured-criterion entry must actually show every carried metric unmeasured', () => {
  const measured: RetirementEntry = {
    caseId: 'A1_ja_002',
    rule: 'unmeasured-criterion',
    reason: 'every carried metric returned {} in the real run',
    evidence: { rule: 'unmeasured-criterion', carriedMetrics: ['trajectory_match', 'tool_correctness'],
      unmeasuredMetrics: ['trajectory_match'] },
    archive: archive(),
  };
  assert.throws(() => check([measured]), /unmeasured/);
});

void test('redundancy must name a retained case in the same canonical cell', () => {
  const entry = (retainedCaseId: string): RetirementEntry => ({
    caseId: 'A1_ja_003',
    rule: 'redundancy',
    reason: 'the same cell keeps three cases',
    evidence: { rule: 'redundancy', retainedCaseId },
    archive: archive(),
  });
  assert.doesNotThrow(() => check([entry('A1_ja_001')]));
  assert.throws(() => check([entry('A1_zh_001')]), /same canonical cell/);
  assert.throws(() => check([entry('missing_case')]), /retained case missing_case/);
  assert.throws(() => check([entry('')]), /retained case/);
});

void test('the locale is inputs.locale, never a segment of the name', () => {
  const jaNamed = candidateOf('A_ja_001', 'A_ja_001', 'ja', ['clarify']);
  const zhNamed = candidateOf('A_zh_001', 'A_zh_001', 'ja', ['clarify']);
  const sameCell: RetirementEntry = {
    caseId: 'A_zh_001', rule: 'redundancy', reason: 'same cell',
    evidence: { rule: 'redundancy', retainedCaseId: 'A_ja_001' },
    archive: archive(),
  };
  assert.doesNotThrow(() => check([sameCell], [jaNamed, zhNamed]));
  const otherStage = [{ ...jaNamed }, { ...zhNamed, acceptableStages: ['search_nearby'] }];
  assert.throws(() => check([sameCell], otherStage), /same canonical cell/);
});

void test('a single-run/pass^k divergence can never delete a case', () => {
  const ruleFour: RetirementEntry = {
    caseId: 'A1_ja_001',
    rule: 'single-run-divergence',
    reason: 'the single-run pass rate is above its pass^k',
    evidence: { rule: 'single-run-divergence', investigation: 'open card for the evaluator' },
    archive: archive(),
  };
  assert.throws(() => check([ruleFour]), /investigation only/);
});

void test('a retiring case cannot be the retained case of another retirement', () => {
  const entries: readonly RetirementEntry[] = [
    { ...VACUOUS, evidence: { rule: 'vacuous-perfect-success', carriedMetrics: ['trajectory_match'],
      doNothingScores: { trajectory_match: 1 }, fullScores: { trajectory_match: 1 } } },
    { caseId: 'A1_ja_002', rule: 'redundancy', reason: 'same cell',
      evidence: { rule: 'redundancy', retainedCaseId: 'A1_ja_001' }, archive: archive() },
  ];
  assert.throws(() => check(entries), /is itself being retired/);
});

void test('duplicate and unknown case IDs are refused as ambiguous', () => {
  const duplicate: readonly RetirementEntry[] = [VACUOUS, { ...VACUOUS, rule: 'unmeasured-criterion',
    evidence: { rule: 'unmeasured-criterion', carriedMetrics: ['x'], unmeasuredMetrics: ['x'] } }];
  assert.throws(() => check(duplicate), /twice/);
  assert.throws(() => check([{ ...VACUOUS, caseId: 'not_in_corpus' }]), /unknown case not_in_corpus/);
  const ambiguous = [...corpus(), candidateOf('A1_ja_001', 'A1_ja_001_copy', 'ja', ['clarify'])];
  assert.throws(() => check([VACUOUS], ambiguous), /ambiguous/);
});

void test('the archive must carry the original inputs, expected output, metadata and evaluators', () => {
  const archiveOf = (value: unknown): RetirementEntry =>
    ({ ...VACUOUS, archive: value as RetirementEntry['archive'] });
  const keep = { inputs: {}, expectedOutput: null, metadata: {}, evaluators: [] };
  assert.throws(() => check([archiveOf({ expectedOutput: null, metadata: {}, evaluators: [] })]), /archive.inputs/);
  assert.throws(() => check([archiveOf({ inputs: {}, metadata: {}, evaluators: [] })]), /archive.expectedOutput/);
  assert.throws(() => check([archiveOf({ inputs: {}, expectedOutput: null, evaluators: [] })]), /archive.metadata/);
  assert.throws(() => check([archiveOf({ inputs: {}, expectedOutput: null, metadata: {} })]), /archive.evaluators/);
  assert.doesNotThrow(() => check([archiveOf(keep)]));
});

void test('every entry names its reason and carries the evidence of its own rule', () => {
  assert.throws(() => check([{ ...VACUOUS, reason: ' ' }]), /reason/);
  const mismatched: RetirementEntry = { ...VACUOUS,
    evidence: { rule: 'unmeasured-criterion', carriedMetrics: ['x'], unmeasuredMetrics: ['x'] } };
  assert.throws(() => check([mismatched]), /evidence for vacuous-perfect-success/);
});

void test('retirement evidence cannot be a bare low score or an unstable run', () => {
  const lowScore: RetirementEntry = { ...VACUOUS,
    reason: 'the case scores 0.2 and is unstable',
    evidence: { rule: 'vacuous-perfect-success', carriedMetrics: ['trajectory_match'],
      doNothingScores: { trajectory_match: 0.2 }, fullScores: { trajectory_match: 1 } } };
  assert.throws(() => check([lowScore]), /scored full/);
});
