/**
 * `docs/DOCS_POLICY.md` rule 7 against the arm that serves it (#1650 AC5).
 *
 * The policy is the canonical statement of the docs-asset URL/object form, so
 * the test reads its examples out of the document and resolves them through the
 * arm's own allowlist rather than restating them: the policy saying one thing
 * and `docs-assets.ts` doing another is the failure this file exists for. Both
 * halves are pinned — the URL → key form, and the key → repository-path rule.
 *
 * test-type: unit (a checked-in document and the arm's resolver; no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolveDocsAsset } from "../src/proxy/docs-assets.ts";

const POLICY = readFileSync(fileURLToPath(new URL("../../../docs/DOCS_POLICY.md", import.meta.url)), "utf8");

/** The one capture group of the policy's first match: the test fails with the
 * name of the sentence the policy stopped writing rather than a bare null. */
function policyMatch(pattern: RegExp): string {
  const match = pattern.exec(POLICY);
  assert.ok(match?.[1], `DOCS_POLICY.md must name ${String(pattern)}`);
  return match[1];
}

/** One policy example with its placeholders filled in. */
const filledPolicyExample = (template: string): string =>
  template.replace("<directory>", "mockups-demo").replace("<asset>", "map-bench-v2").replace("<ext>", "png");

void test("DOCS_POLICY.md's canonical URL resolves to the stored key it documents", () => {
  const urlPath = policyMatch(/https:\/\/animichi\.com(\/img\/docs\/archive\/<directory>\/<asset>\.<ext>)/);
  const storedKey = policyMatch(/`(archive\/<directory>\/<asset>\.<ext>)`/);
  assert.deepEqual(resolveDocsAsset(filledPolicyExample(urlPath.slice("/img/".length))), {
    kind: "asset",
    asset: { key: filledPolicyExample(storedKey), contentType: "image/png" },
  });
});

void test("DOCS_POLICY.md's object key is the repository path with its leading docs/ dropped", () => {
  const repositoryPath = policyMatch(/`(docs\/archive\/<directory>\/<asset>\.<ext>)`/);
  const storedKey = policyMatch(/`(archive\/<directory>\/<asset>\.<ext>)`/);
  assert.equal(filledPolicyExample(storedKey), filledPolicyExample(repositoryPath).replace(/^docs\//, ""));
});

void test("the allowlist's length bound is the one DOCS_POLICY.md states", () => {
  const bound = Number(policyMatch(/a key is at most (\d+)\s+characters/));
  const keyAt = (length: number): string => `archive/${"a".repeat(length - "archive/.png".length)}.png`;
  assert.equal(resolveDocsAsset(`docs/${keyAt(bound)}`).kind, "asset");
  assert.equal(resolveDocsAsset(`docs/${keyAt(bound + 1)}`).kind, "refused");
});
