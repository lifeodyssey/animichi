import { objectOrNull } from '../json-object.ts';

/**
 * The four case-retirement rules, as an auditable ledger.
 *
 * A case is retired only when a case or its verifier has a *reviewable defect* —
 * never because its score is low and never because it is unstable. The ledger
 * is the artefact that keeps that distinction: each entry names the rule, the
 * rule-specific evidence and the archived original, and this module refuses a
 * reference that is ambiguous, a retained case that is itself retiring, or one
 * of the three allowed reasons applied to a case that does not meet it.
 *
 * Rule 4 is not a retirement rule: a single-run/pass^k divergence opens an
 * investigation first, and the divergence itself is what pass^k exists to
 * expose. The canonical corpus survives retirement — the archived cases stay
 * in `datasets/`, and only an explicit ledger entry removes one from an active
 * roster.
 */
export const RETIREMENT_RULES = [
  'vacuous-perfect-success',
  'unmeasured-criterion',
  'redundancy',
  'single-run-divergence',
] as const;

export type RetirementRule = (typeof RETIREMENT_RULES)[number];

/** A source case as the canonical corpus declares it. */
export interface RetirementCandidate {
  /** The frozen case ID; the ledger names this, never a report display name. */
  readonly id: string;
  readonly name: string;
  /** `inputs.locale`, never a segment parsed out of the name. */
  readonly locale: string;
  /** `metadata.acceptable_stages`; each one is its own cell. */
  readonly acceptableStages: readonly string[];
}

/** The original native material an archive keeps, verbatim. */
export interface ArchivedCase {
  readonly inputs: unknown;
  readonly expectedOutput: unknown;
  readonly metadata: unknown;
  readonly evaluators: readonly unknown[];
}

/**
 * Rule-specific evidence. The shape is the rule: a vacuous case must show the
 * do-nothing trajectory scoring full on every metric it carries, an unmeasured
 * case must show every carried metric returning nothing, a redundant case must
 * name the retained case in its cell, and a divergence can only open an
 * investigation.
 */
export type RetirementEvidence =
  | {
    readonly rule: 'vacuous-perfect-success';
    readonly carriedMetrics: readonly string[];
    readonly doNothingScores: Readonly<Record<string, number>>;
    readonly fullScores: Readonly<Record<string, number>>;
  }
  | {
    readonly rule: 'unmeasured-criterion';
    readonly carriedMetrics: readonly string[];
    readonly unmeasuredMetrics: readonly string[];
  }
  | { readonly rule: 'redundancy'; readonly retainedCaseId: string }
  | { readonly rule: 'single-run-divergence'; readonly investigation: string };

export interface RetirementEntry {
  readonly archive: ArchivedCase;
  readonly caseId: string;
  readonly evidence: RetirementEvidence;
  readonly reason: string;
  readonly rule: RetirementRule;
}

/**
 * Hold a retirement ledger to the four rules: known case IDs, one decision per
 * case, the rule's own evidence, a retained case that stays active, and an
 * archive that carries the original native material.
 */
export function validateRetirementLedger(
  entries: readonly RetirementEntry[],
  candidates: readonly RetirementCandidate[],
): void {
  const index = indexCandidates(candidates);
  rejectDuplicateDecisions(entries);
  const retired = new Set(entries.map((entry) => entry.caseId));
  for (const entry of entries) validateEntry(entry, index, retired);
}

/** The canonical cell a name/locale/stage triple identifies, one per stage. */
export function cellsOf(candidate: RetirementCandidate): readonly string[] {
  const family = familyOf(candidate.name);
  return candidate.acceptableStages.map((stage) => `${family}\u0000${candidate.locale}\u0000${stage}`);
}

/**
 * `family` normalization, the canonical two-step form: drop the trailing
 * sequence number, then delete every locale segment. A one-step `/^(.+?)_(ja|zh|en)_\d+$/`
 * misses names like `HO_loc_zh_jaq_001`, so the segment pass is not optional.
 */
export function familyOf(caseName: string): string {
  return caseName.replace(/_\d+$/u, '').replace(/_(?:ja|zh|en)q?(?=_|$)/gu, '');
}

/** The archived IDs, in ledger order; nothing else removes a case from a roster. */
export function retiredCaseIds(entries: readonly RetirementEntry[]): readonly string[] {
  return entries.map((entry) => entry.caseId);
}

function validateEntry(
  entry: RetirementEntry,
  index: ReadonlyMap<string, RetirementCandidate>,
  retired: ReadonlySet<string>,
): void {
  const candidate = index.get(entry.caseId);
  if (candidate === undefined) throw new RangeError(`retirement ledger names unknown case ${entry.caseId}`);
  if (entry.reason.trim() === '') throw new TypeError(`${entry.caseId}: a retirement needs a reason`);
  validateArchive(entry);
  validateEvidence(entry, { caseId: entry.caseId, candidate, index, retired });
}

/** Rule-specific evidence, narrowed to the one rule whose check inspects it. */
type RuleEvidence<R extends RetirementRule> = Extract<RetirementEvidence, { readonly rule: R }>;

/**
 * What a rule's check reads besides its own evidence: the case it retires, the
 * canonical candidate that case resolves to, the corpus index it came from,
 * and the cases retiring alongside it.
 */
interface RuleCheckContext {
  readonly caseId: string;
  readonly candidate: RetirementCandidate;
  readonly index: ReadonlyMap<string, RetirementCandidate>;
  readonly retired: ReadonlySet<string>;
}

type RuleCheck<R extends RetirementRule> = (evidence: RuleEvidence<R>, context: RuleCheckContext) => void;

/**
 * The check each rule demands of its own evidence, one row per rule: a rule
 * added to `RETIREMENT_RULES` carries no check until one is named here. Rule 4
 * has a row because it too answers for its evidence — by refusing, since only
 * the other three rules can delete a case.
 */
const RULE_CHECKS: { readonly [R in RetirementRule]: RuleCheck<R> } = {
  'vacuous-perfect-success': validateVacuous,
  'unmeasured-criterion': validateUnmeasured,
  'redundancy': validateRedundancy,
  'single-run-divergence': refuseDivergenceRetirement,
};

/** The check the evidence of `rule` must pass. */
function ruleCheckFor<R extends RetirementRule>(rule: R): RuleCheck<R> {
  return RULE_CHECKS[rule];
}

/** One entry's evidence: it must declare the entry's rule, which then checks it. */
function validateEvidence(entry: RetirementEntry, context: RuleCheckContext): void {
  const evidence = entry.evidence;
  if (evidence.rule !== entry.rule) {
    throw new TypeError(`${entry.caseId}: evidence for ${entry.rule} must declare rule ${entry.rule}`);
  }
  ruleCheckFor(evidence.rule)(evidence, context);
}

function validateVacuous(
  evidence: RuleEvidence<'vacuous-perfect-success'>,
  context: RuleCheckContext,
): void {
  if (evidence.carriedMetrics.length === 0) {
    throw new TypeError(`${context.caseId}: vacuous-perfect-success needs the metrics the case carries`);
  }
  const full = evidence.carriedMetrics.every((metric) =>
    evidence.doNothingScores[metric] !== undefined && evidence.doNothingScores[metric] === evidence.fullScores[metric]);
  if (!full) {
    throw new TypeError(`${context.caseId}: vacuous-perfect-success evidence must show the do-nothing trajectory scored full `
      + 'on every carried metric');
  }
}

function validateUnmeasured(
  evidence: RuleEvidence<'unmeasured-criterion'>,
  context: RuleCheckContext,
): void {
  if (evidence.carriedMetrics.length === 0) {
    throw new TypeError(`${context.caseId}: unmeasured-criterion needs the metrics the case carries`);
  }
  const unmeasured = new Set(evidence.unmeasuredMetrics);
  if (!evidence.carriedMetrics.every((metric) => unmeasured.has(metric))) {
    throw new TypeError(`${context.caseId}: unmeasured-criterion evidence must list every carried metric as unmeasured`);
  }
}

function validateRedundancy(
  evidence: RuleEvidence<'redundancy'>,
  context: RuleCheckContext,
): void {
  const { retainedCaseId } = evidence;
  const { caseId, candidate, index, retired } = context;
  const retained = index.get(retainedCaseId);
  if (retained === undefined) throw new RangeError(`${caseId}: redundant retirement names no retained case ${retainedCaseId}`);
  if (retired.has(retainedCaseId)) throw new RangeError(`${caseId}: retained case ${retainedCaseId} is itself being retired`);
  const cells = new Set(cellsOf(candidate));
  if (!cellsOf(retained).some((cell) => cells.has(cell))) {
    throw new RangeError(`${caseId}: retained case ${retainedCaseId} is not in the same canonical cell`);
  }
}

/** A divergence opens an investigation; rule 4 never retires the case it names. */
function refuseDivergenceRetirement(
  evidence: RuleEvidence<'single-run-divergence'>,
  context: RuleCheckContext,
): void {
  throw new RangeError(`${context.caseId}: ${evidence.rule} is investigation only, never a retirement`);
}

function validateArchive(entry: RetirementEntry): void {
  const archive = objectOrNull(entry.archive);
  if (archive === null) throw new TypeError(`${entry.caseId}: a retirement needs an archive`);
  for (const field of ['inputs', 'expectedOutput', 'metadata', 'evaluators']) {
    if (!Object.hasOwn(archive, field)) throw new TypeError(`${entry.caseId}: archive.${field} is required`);
  }
}

function rejectDuplicateDecisions(entries: readonly RetirementEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.caseId)) throw new RangeError(`retirement ledger names case ${entry.caseId} twice`);
    seen.add(entry.caseId);
  }
}

function indexCandidates(candidates: readonly RetirementCandidate[]): ReadonlyMap<string, RetirementCandidate> {
  const index = new Map<string, RetirementCandidate>();
  for (const candidate of candidates) {
    if (index.has(candidate.id)) throw new RangeError(`case ID ${candidate.id} is ambiguous in the canonical corpus`);
    index.set(candidate.id, candidate);
  }
  return index;
}
