import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from '@earendil-works/pi-ai';
import type { GeocodeCandidate, GeocodeResult } from '@animichi/contract/contract';
import type { Point, ResolveOutcome } from '@animichi/contract/models';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { loadPrefixCorpus, type LoadedPrefixCorpus, type PrefixCase } from '../src/native/prefix-corpus.ts';
import { openPrefixReplay, type PrefixReplay } from '../src/native/prefix-replay.ts';
import { canonicalSelectionCases, selectionPlans, type CanonicalCandidate, type CanonicalSelectionCase } from '../src/native/prefix-cases.ts';
import { recordBoundaries, writePrefixCorpus } from '../src/native/prefix-record.ts';
import { fixtureCatalog, type CatalogFixture } from './native-prefix-catalog.ts';
import { recordingProvenance, scriptedPorts } from './native-prefix-fixture.ts';

/** The place the precursor nearby search resolves to before the ambiguous one. */
const PRECURSOR = { id: 'seed:kyoto', label: '京都(京都府)', name: '京都', lat: 35.0116, lng: 135.7681, kind: 'city' as const, source: 'seed' as const, effective_radius_m: 20_000 };

/** The scripted production turn that reaches each boundary: one search, then the ambiguity. */
export function phase1cScripts(cases: readonly CanonicalSelectionCase[]): FauxResponseStep[] {
  const steps: FauxResponseStep[] = [];
  for (const entry of cases) {
    const first = firstCandidate(entry);
    steps.push(fauxAssistantMessage(precursorCall(entry, first), { stopReason: 'toolUse' }));
    steps.push(fauxAssistantMessage(ambiguityCall(entry, first), { stopReason: 'toolUse' }));
    steps.push(fauxAssistantMessage('Which one did you mean?'));
  }
  return steps;
}

function precursorCall(entry: CanonicalSelectionCase, first: CanonicalCandidate) {
  return entry.seeded_pending.reason === 'anime_ambiguity'
    ? fauxToolCall('search_bangumi', { bangumi_id: first.id })
    : fauxToolCall('search_nearby', { location: PRECURSOR.label });
}

function ambiguityCall(entry: CanonicalSelectionCase, first: CanonicalCandidate) {
  return entry.seeded_pending.reason === 'anime_ambiguity'
    ? fauxToolCall('resolve_anime', { title: first.title })
    : fauxToolCall('search_nearby', { location: placeQuery(first) });
}

/** One worked example per canonical candidate, plus the precursor place; no live catalog is touched. */
export function phase1cCatalog(cases: readonly CanonicalSelectionCase[]): CatalogFixture {
  const drafts: CatalogDrafts = { resolve: {}, geocode: { [PRECURSOR.label]: { candidates: [PRECURSOR] } },
    pointsById: {}, works: {}, nearby: {} };
  const add = (entry: Point): string => { drafts.pointsById[entry.id] = entry; return entry.id; };
  drafts.nearby[keyOf(PRECURSOR)] = [add(point('seed:kyoto-point', '京都御所', PRECURSOR.id))];
  for (const entry of cases) addCase(drafts, entry, add);
  return drafts;
}

interface CatalogDrafts {
  resolve: Record<string, ResolveOutcome>; geocode: Record<string, GeocodeResult>;
  pointsById: Record<string, Point>; works: Record<string, readonly string[]>; nearby: Record<string, readonly string[]>;
}

function addCase(drafts: CatalogDrafts, entry: CanonicalSelectionCase, add: (entry: Point) => string): void {
  const first = firstCandidate(entry);
  if (entry.seeded_pending.reason === 'anime_ambiguity') { addWorks(drafts, entry, add); return; }
  drafts.geocode[placeQuery(first)] = { candidates: entry.seeded_pending.ordered_candidates.map(placeCandidate) };
  drafts.nearby[keyOf(first)] = [add(point('seed:uji-point', '宇治平等院', first.id))];
}

function addWorks(drafts: CatalogDrafts, entry: CanonicalSelectionCase, add: (entry: Point) => string): void {
  const first = firstCandidate(entry);
  drafts.resolve[first.title] = { outcome: 'needs_disambiguation', reason: 'anime_ambiguity',
    candidates: entry.seeded_pending.ordered_candidates.map((candidate) => ({ bangumi_id: candidate.id, title: candidate.title })) };
  for (const candidate of entry.seeded_pending.ordered_candidates) {
    drafts.works[candidate.id] = contributes(candidate) ? [add(point(`${candidate.id}-point`, candidate.title, candidate.id))] : [];
  }
}

/** The canonical 999xxx ids are the missing works; every other candidate contributes points. */
function contributes(candidate: CanonicalCandidate): boolean {
  return !candidate.id.startsWith('999');
}

/** Record and write the phase1c prefix corpus through the production harness. */
export async function recordPhase1cCorpus(root: string): Promise<void> {
  const cases = await canonicalSelectionCases();
  const recorded = await recordBoundaries(selectionPlans(cases),
    scriptedPorts(phase1cScripts(cases), fixtureCatalog([], phase1cCatalog(cases))), recordingProvenance());
  await writePrefixCorpus(root, 'phase1c_selection_v1', recorded);
}

/** Record the phase1c corpus into a scratch root and open its replay. */
export async function openedReplay(root: string): Promise<{ corpus: LoadedPrefixCorpus; replay: PrefixReplay }> {
  await recordPhase1cCorpus(root);
  const corpus = await loadPrefixCorpus('phase1c_selection_v1', root);
  return { corpus, replay: await openPrefixReplay(corpus, BACKGROUND_CONTEXT) };
}

/** Run a test against a freshly recorded corpus, closing the scratch repository afterwards. */
export async function withRecordedCorpus(
  run: (replay: PrefixReplay, corpus: LoadedPrefixCorpus) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-recorded-'));
  const { replay, corpus } = await openedReplay(root);
  try {
    await run(replay, corpus);
  } finally {
    await replay.close(BACKGROUND_CONTEXT);
    await rm(root, { recursive: true, force: true });
  }
}

/** The recorded case that belongs to a canonical id. */
export function caseNamed(corpus: { cases: readonly PrefixCase[] }, id: string): PrefixCase {
  const found = corpus.cases.find((entry) => entry.name === id);
  if (found === undefined) throw new Error(`prefix corpus has no case ${id}`);
  return found;
}

function firstCandidate(entry: CanonicalSelectionCase): CanonicalCandidate {
  const first = entry.seeded_pending.ordered_candidates[0];
  if (first === undefined) throw new TypeError(`${entry.id}: the canonical boundary has no candidates`);
  return first;
}

/** The canonical place title carries its region in parentheses; the gazetteer query does not. */
function placeQuery(candidate: CanonicalCandidate): string {
  return candidate.title.replace(/\(.*\)$/u, '');
}

function placeCandidate(candidate: CanonicalCandidate): GeocodeCandidate {
  return { id: candidate.id, label: candidate.title, name: candidate.title,
    lat: candidate.lat ?? 0, lng: candidate.lng ?? 0, kind: 'city', source: 'seed',
    ...(candidate.effective_radius_m === undefined ? {} : { effective_radius_m: candidate.effective_radius_m }) };
}

function keyOf(candidate: { lat?: number; lng?: number }): string {
  return `${String(candidate.lat ?? 0)},${String(candidate.lng ?? 0)}`;
}

function point(id: string, name: string, work: string): Point {
  return { id, name, bangumi_id: work, screenshot_url: '', latitude: 35, longitude: 135 };
}

export { canonicalSelectionCases, selectionPlans };
