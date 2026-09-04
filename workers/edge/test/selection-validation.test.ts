/**
 * Whether a pick may answer the open question (card #1288).
 *
 * The refusal TEXTS are asserted verbatim, not just the fact of a refusal:
 * `validate_candidate_selection` raised them as the sentence the visitor reads,
 * so they are wire and a reworded one is a visible difference between the
 * container and this tier.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SelectionRefused,
  validateCandidateSelection,
} from "../src/agent/selection/candidate-selection.ts";
import { SessionEnvelope } from "../src/agent/session/session-envelope.ts";
import type { OrderedCandidate } from "../src/agent/tools/catalog-tool-session.ts";

const WORKS: OrderedCandidate[] = [
  { id: "1", title: "らき☆すた" },
  { id: "2", title: "らき☆すた OVA" },
];
const PLACES: OrderedCandidate[] = [
  { id: "kyoto", title: "京都", lat: 35.01, lng: 135.76 },
  { id: "kyotanabe", title: "京田辺", lat: 34.81, lng: 135.76 },
];

/** A session whose only turn asked one question, under id 1. */
function asked(reason: string, candidates: OrderedCandidate[]) {
  return SessionEnvelope.empty.withClarification(reason, candidates).pendingClarification;
}

const EXPIRED = "This choice expired; please try again.";
const WRONG_MODE = "This clarification requires a different response mode.";

void test("an anime pick may name as many works as the user wants merged", () => {
  const verdict = validateCandidateSelection(asked("anime_ambiguity", WORKS), ["1", "2"], 1);
  assert.deepEqual([verdict.candidateIds, verdict.mode], [["1", "2"], "anime_ambiguity"]);
});

void test("a place pick may name exactly one place", () => {
  const verdict = validateCandidateSelection(asked("place_ambiguity", PLACES), ["kyoto"], 1);
  assert.deepEqual([verdict.candidateIds, verdict.mode], [["kyoto"], "place_ambiguity"]);
});

void test("a pick naming another question's id is stale", () => {
  const refused = () => validateCandidateSelection(asked("anime_ambiguity", WORKS), ["1"], 2);
  assert.throws(refused, new SelectionRefused(EXPIRED));
});

void test("a pick arriving when nothing is open is stale", () => {
  assert.throws(() => validateCandidateSelection(null, ["1"], 1), new SelectionRefused(EXPIRED));
});

void test("a pick naming a candidate the question never offered is stale", () => {
  const refused = () => validateCandidateSelection(asked("anime_ambiguity", WORKS), ["9"], 1);
  assert.throws(refused, new SelectionRefused(EXPIRED));
});

void test("a pick naming nothing at all is stale", () => {
  const refused = () => validateCandidateSelection(asked("anime_ambiguity", WORKS), [], 1);
  assert.throws(refused, new SelectionRefused(EXPIRED));
});

void test("two places picked at once is the wrong response mode", () => {
  const refused = () => validateCandidateSelection(asked("place_ambiguity", PLACES), ["kyoto", "kyotanabe"], 1);
  assert.throws(refused, new SelectionRefused(WRONG_MODE));
});

void test("a question with no selection mode takes no pick", () => {
  const refused = () => validateCandidateSelection(asked("unknown_place", WORKS), ["1"], 1);
  assert.throws(refused, new SelectionRefused(WRONG_MODE));
});

void test("a second question outranks the first, so the first question's id is dead", () => {
  const first = SessionEnvelope.empty.withClarification("anime_ambiguity", WORKS);
  const second = first.cleared().withClarification("anime_ambiguity", WORKS);
  assert.deepEqual([first.pendingClarification?.id, second.pendingClarification?.id], [1, 2]);
  const refused = () => validateCandidateSelection(second.pendingClarification, ["1"], 1);
  assert.throws(refused, new SelectionRefused(EXPIRED));
});
