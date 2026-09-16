/**
 * The case inputs of the phase1c selection corpus and the identity of the
 * production agent that records them (#1558).
 *
 * The canonical export stays the source of the case inputs — the prompt, the
 * locale, the offered candidates and the selection the case expects — while the
 * trajectory is always recorded fresh through the production harness. Reading
 * the canonical copy here is what keeps "the inputs may be reused, the
 * trajectories may not" a machine-checked distinction.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NATIVE_SYSTEM_PROMPT } from '@animichi/agent';
import { planRoute, resolveAnime, respond, searchBangumi, searchNearby, translateAnimeTitle, webSearch } from '@animichi/agent/tools';
import type { PrefixRecordingPlan } from './prefix-record.ts';

const CANONICAL_SELECTION = fileURLToPath(new URL('../../datasets/canonical/phase1c_selection_v1.json', import.meta.url));

/** The prompt identity a reader can re-derive from the production system prompt. */
export function promptIdentity(): string {
  return `sha256:${createHash('sha256').update(NATIVE_SYSTEM_PROMPT).digest('hex').slice(0, 12)}`;
}

/** The seven production tools, in the order the harness advertises them. */
export function productionToolNames(): string[] {
  return [resolveAnime, searchBangumi, searchNearby, planRoute, translateAnimeTitle, webSearch, respond].map((tool) => tool.name);
}

export interface CanonicalCandidate {
  readonly id: string;
  readonly title: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly effective_radius_m?: number;
}

export interface CanonicalSelectionCase {
  readonly id: string;
  readonly query: string;
  readonly locale: string;
  readonly selected_candidate_ids: readonly string[];
  readonly expect_nonempty?: boolean | null;
  readonly seeded_pending: { readonly reason: string; readonly ordered_candidates: readonly CanonicalCandidate[] };
}

/** The five frozen case inputs, read from the canonical copy rather than re-exported. */
export async function canonicalSelectionCases(path: string = CANONICAL_SELECTION): Promise<readonly CanonicalSelectionCase[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(raw) || raw.length !== 5) throw new TypeError('phase1c_selection_v1: expected five canonical cases');
  return raw as CanonicalSelectionCase[];
}

/** One recording plan per canonical boundary, in canonical order. */
export function selectionPlans(cases: readonly CanonicalSelectionCase[]): PrefixRecordingPlan[] {
  return cases.map((entry) => ({
    id: entry.id, prompt: entry.query, locale: entry.locale, boundary: boundaryOf(entry),
    expectedNextAction: { tool: 'none', domain_entry: 'animichi.selection',
      arguments: [{ kind: 'set', argument: 'candidateIds',
        values: [...entry.seeded_pending.ordered_candidates.map((candidate) => candidate.id)],
        max_items: entry.seeded_pending.ordered_candidates.length }],
      forbidden: { tools: ['respond', 'search_bangumi', 'search_nearby', 'plan_route'], arguments: [] } },
    selection: { candidateIds: entry.selected_candidate_ids,
      expected: { status: nonEmpty(entry) ? 'ok' : 'empty', expect_nonempty: nonEmpty(entry) } },
  }));
}

function boundaryOf(entry: CanonicalSelectionCase): string {
  return entry.seeded_pending.reason === 'anime_ambiguity' ? 'pending_anime_ambiguity' : 'pending_place_ambiguity';
}

function nonEmpty(entry: CanonicalSelectionCase): boolean {
  return entry.expect_nonempty === true;
}
