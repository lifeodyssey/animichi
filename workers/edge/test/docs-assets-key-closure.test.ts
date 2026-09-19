/**
 * The invariant that makes "the check and the fetch agree" true by
 * construction (#1650 AC1).
 *
 * `docs-assets.ts` *produces* the key: the bucket is read with the very string
 * the allowlist approved, never with a key somebody else built and the allowlist
 * merely blessed. That closes the usual gap between a check and a fetch, and it
 * leaves exactly one way for the two to still disagree — an approved key that a
 * later normalisation would change. `decodeURIComponent` is that normalisation,
 * and the allowlist forecloses it by construction: `SAFE_SEGMENT` admits no `%`,
 * so decoding is the identity on every key it approves.
 *
 * Nothing said so, and nothing checked. Three probes left the suites fully
 * green: decoding the key between the check and the fetch; admitting `%` to the
 * segment class; and both together. The third is a real escape — with the class
 * relaxed, `/img/docs/archive/a%20b.png` is approved as `archive/a%20b.png` and
 * the bucket is then read for `archive/a b.png`, an object the allowlist does
 * not name. The closure asserted here is what turns that red.
 *
 * The `%`-bearing corpus below is deliberately split: the paths the outer
 * `/img/` boundary already refuses (defence in depth, so this file never rests
 * on it) and the paths it passes — those are the ones that would reach the arm
 * and escape.
 *
 * test-type: unit (the arm's resolver and the app's `/img` path; no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveDocsAsset } from "../src/proxy/docs-assets.ts";
import { docsAssetBinding, withoutImageOrigin } from "./doubles/docs-asset-doubles.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";

/** Paths a `%`-admitting segment class would approve, and what would go wrong.
 * The first two reach the arm behind the outer boundary; the rest the boundary
 * already refuses on its own. */
const PERCENT_BEARING = [
  "docs/archive/a%20b.png",
  "docs/archive/pho%74o.png",
  "docs/archive/%2e%2e/secret.png",
  "docs/archive/%2E%2E/secret.png",
  "docs/archive/%252e%252e/secret.png",
  "docs/archive/a%2fb.png",
  "docs/archive/a%5cb.png",
  "docs/archive/%2e.png",
];

/** Paths the allowlist does approve, so the closure below is not vacuous. */
const APPROVABLE = [
  "docs/archive/mockups-demo/map-bench-v2.png",
  "docs/archive/landing-hero/hero.jpg",
  "docs/archive/review-boards/board_2026-08.jpeg",
  "docs/archive/v1.2/figure.webp",
  "docs/archive/a..b.png",
  "docs/archive/A-Z_0.9.gif",
];

const approvedKey = (imagePath: string): string | null => {
  const resolution = resolveDocsAsset(imagePath);
  return resolution.kind === "asset" ? resolution.asset.key : null;
};

void test("a percent escape is not a character the allowlist admits to a key", () => {
  const approved = PERCENT_BEARING.filter((imagePath) => approvedKey(imagePath) !== null);
  assert.deepEqual(approved, [], "a `%` in an approved key is a key the reader may decode differently");
});

void test("no key the allowlist approves is changed by the normalisations a reader could apply", () => {
  const keys = APPROVABLE.map((imagePath) => approvedKey(imagePath));
  assert.deepEqual(keys.filter((key) => key === null), [], "the control corpus must all be approved");
  const changed = keys.filter((key) => key !== null && decodeURIComponent(key) !== key);
  assert.deepEqual(changed, [], "the check and the fetch would not be holding the same string");
});

void test("nothing approved out of an adversarial corpus is changed by decoding", () => {
  // The guard. It holds vacuously while the segment class excludes `%`, and
  // fires the moment the class stops — which is the only way this arm can read
  // an object its allowlist does not name.
  const changed = PERCENT_BEARING.filter((imagePath) => {
    const key = approvedKey(imagePath);
    return key !== null && decodeURIComponent(key) !== key;
  });
  assert.deepEqual(changed, [], "an approved key whose decoded form differs is an object the allowlist did not name");
});

void test("the bucket is read with the key the allowlist produced, not a re-derived one", async (t) => {
  const reads: string[] = [];
  const imagePath = "docs/archive/mockups-demo/map-bench-v2.png";
  const response = await withoutImageOrigin(t, () => edgeAppRequest(`/img/${imagePath}`, docsAssetBinding(reads)));
  assert.equal(response.status, 200);
  assert.equal(approvedKey(imagePath), reads[0]);
});

void test("a percent-bearing path the outer boundary passes never reaches the bucket", async (t) => {
  const reads: string[] = [];
  const response = await withoutImageOrigin(t, () =>
    edgeAppRequest("/img/docs/archive/a%20b.png", docsAssetBinding(reads)));
  assert.equal(response.status, 400);
  assert.deepEqual(reads, []);
});
