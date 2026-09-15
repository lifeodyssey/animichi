/** #1650: the private docs-asset bucket, and the bindings that reach it.
 *
 * Three files have to agree before `/img/docs` can serve anything: Pulumi
 * creates the bucket, each wrangler ring binds it under a name, and the Worker's
 * `Env` declares that name. Every link is a string somebody else wrote, and a
 * broken one is silent — the binding is simply absent, and the arm fails closed
 * with a 503 that nobody sees until an asset is requested.
 *
 * Privacy is NOT restated here: an R2 bucket is public only when an R2 custom
 * domain is attached, and `topology-prod.test.ts` asserts none exist anywhere on
 * this stack — docs-assets included. A second copy of that assertion in this
 * file would be a fourth place to keep in step (#1650 review S18).
 *
 * The default and staging rings deliberately share ONE non-production bucket:
 * a command without an explicit production environment must not be able to
 * read production assets.
 *
 * test-type: unit (mocked Pulumi resources + checked-in config; no cloud).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, TomlDate, type TomlTable, type TomlValue } from "smol-toml";
import { buildStack, ofType } from "./testing/harness.ts";

const R2_BUCKET = "cloudflare:index/r2Bucket:R2Bucket";
const EDGE_WRANGLER = "../workers/edge/wrangler.toml";
const EDGE_ENV = "../workers/edge/src/env.ts";

interface R2Binding {
  readonly binding: string;
  readonly bucket_name: string;
}

const built = await buildStack("prod", { cloudflareAccountId: "acct" });
const document: TomlTable = parse(readFileSync(fileURLToPath(new URL(EDGE_WRANGLER, import.meta.url)), "utf8"));

/** A TOML value as the table it has to be; anything else reads as empty, so a
 * renamed key fails in the assertion that names the ring rather than as a
 * `cannot read properties of undefined` somewhere below. */
function asTable(value: TomlValue | undefined): TomlTable {
  const isTable = typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof TomlDate);
  return isTable ? value : {};
}

function bindingOf(entry: TomlValue): R2Binding[] {
  const { binding, bucket_name: bucketName } = asTable(entry);
  return typeof binding === "string" && typeof bucketName === "string" ? [{ binding, bucket_name: bucketName }] : [];
}

/** The `r2_buckets` entries of one ring: the base document for the default ring
 * (`wrangler dev` and an un-named deploy read it), `env.<name>` for a named
 * one — wrangler nests every named ring under `env`. */
function ringBindings(environment?: string): R2Binding[] {
  const env = asTable(document["env"]);
  const ring = environment === undefined ? document : asTable(env[environment]);
  const entries = ring["r2_buckets"];
  return Array.isArray(entries) ? entries.flatMap(bindingOf) : [];
}

/** Each ring's binding block, and the bucket name it must resolve to. */
const RINGS = [
  { ring: "default", bindings: ringBindings(), bucket: "docs-assets-staging" },
  { ring: "staging", bindings: ringBindings("staging"), bucket: "docs-assets-staging" },
  { ring: "production", bindings: ringBindings("production"), bucket: "docs-assets" },
] as const;

const docsBindings = (bindings: R2Binding[]): R2Binding[] =>
  bindings.filter((entry) => entry.binding === "DOCS_ASSETS");

test("Pulumi builds the docs-asset bucket on the stack's own account", () => {
  const buckets = ofType(built, R2_BUCKET);
  const docs = buckets.filter((bucket) => bucket.inputs.name === "docs-assets");
  assert.equal(
    docs.length,
    1,
    `expected one production docs-asset bucket, built: ${buckets.map((bucket) => String(bucket.inputs.name)).join(", ")}`,
  );
  assert.equal(docs[0]?.inputs.accountId, "acct");
});

for (const { ring, bindings, bucket } of RINGS) {
  test(`the ${ring} ring binds DOCS_ASSETS to the ${bucket} bucket`, () => {
    assert.deepEqual(docsBindings(bindings), [{ binding: "DOCS_ASSETS", bucket_name: bucket }]);
  });
}

test("a preview stack's docs-asset bucket is its own, isolated from both live buckets", async () => {
  // The naming scheme's other half (#1650 review S29): prod and staging are
  // pinned by the rings above, and an unrecognised stack must not resolve to
  // either of them. `src/config.ts` is imported HERE because it reads
  // `pulumi.Config` while it evaluates, and `buildStack` above is what installs
  // the stack config it reads.
  const { docsAssetsBucketNameFor } = await import("./src/config.ts");
  assert.equal(docsAssetsBucketNameFor("preview-1650"), "docs-assets-preview-1650");
  assert.notEqual(docsAssetsBucketNameFor("preview-1650"), docsAssetsBucketNameFor("staging"));
});

test("the Worker's Env declares the binding name the config injects", () => {
  // The third link: wrangler injects `env.DOCS_ASSETS`, and the proxy reads it
  // by that name through this field. Two spellings would typecheck separately.
  assert.match(readFileSync(fileURLToPath(new URL(EDGE_ENV, import.meta.url)), "utf8"), /DOCS_ASSETS\?: R2ObjectBucket;/);
});
