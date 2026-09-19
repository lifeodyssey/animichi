/**
 * The README's signing-key contract, read against the code that enforces it
 * (#1806): the document states the shape a key must have, and this holds that
 * statement to the service's guard and the catalog's mirror of it, so a README
 * that stops stating the enforced shape fails here by name.
 *
 * It pins the SHAPE and the words that state it as the requirement — not the
 * sentence around them, which may be rewritten freely. What it cannot see is a
 * catalog-only edit: like the rest of this package's suite it runs when
 * `apps/anitabi-egress` is gated, while the catalog's own suite is what holds
 * that side's behaviour wherever it runs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/** The repository root, from this file's own location (`<root>/apps/anitabi-egress/test/`). */
const ROOT = new URL("../../../", import.meta.url);

const README = "apps/anitabi-egress/README.md";
const SERVICE = "apps/anitabi-egress/src/egress-config.ts";
const CALLER = "workers/catalog/src/ingest/anitabi-egress.ts";

/** Repo-relative path → its text. */
function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");
}

/**
 * The pattern a side applies to a candidate key, read from its `isSigningKey`.
 * Read as text rather than executed: this is a pin between three sources, and
 * each side's own suite is what holds its behaviour. Exactly one such
 * definition must exist — a second one, in a comment or a second function,
 * would make this read something other than the guard.
 */
function enforcedShape(path: string): string {
  const found = [...read(path).matchAll(/return (\/[^;]*\/)\.test\(value\)/g)];
  assert.equal(found.length, 1, `${path} must state the key's shape in one isSigningKey; this pin reads it there`);
  const shape = found.at(0)?.[1];
  assert.ok(shape !== undefined, `${path}'s isSigningKey must test a literal pattern, not a computed one`);
  return shape;
}

void describe("the signing-key shape the README states", () => {
  void it("is quoted as the requirement, and is the shape the service tests a key against", () => {
    const shape = enforcedShape(SERVICE);
    assert.ok(
      read(README).includes(`must match \`${shape}\``),
      `${README} must state the shape ${SERVICE} enforces — ${shape} — as what a key is required to match, and ` +
        "go on to say what that check does and does not prove about one",
    );
  });

  void it("is the shape the catalog tests a key against, so one key satisfies both sides", () => {
    assert.equal(
      enforcedShape(CALLER),
      enforcedShape(SERVICE),
      `${CALLER} and ${SERVICE} must test one shape: two shapes are two contracts, and ${README} states one`,
    );
  });
});
