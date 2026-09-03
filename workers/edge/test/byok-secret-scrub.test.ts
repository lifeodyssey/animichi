import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, SecretScrub } from "../src/agent/egress/secret-scrub.ts";

// W0-S5 (#1248): the last red line — a key must not survive into a log line,
// a span attribute or an error body. Every shape below is one the three BYOK
// provider families actually issue, plus the raw literal for the shapes none
// of the patterns can know about.
//
// test-type: unit (pure string work, no network, no clock).

const OPENAI_KEY = "sk-proj-Aa0Bb1Cc2Dd3Ee4Ff5Gg6Hh7";
const ANTHROPIC_KEY = "sk-ant-api03-Zz9Yy8Xx7Ww6Vv5Uu4";
const GOOGLE_KEY = "AIzaSyA0b1C2d3E4f5G6h7I8j9K0l1M2n3O4p5Q";
const OPAQUE_KEY = "8f14e45fceea167a5a36dedd4bea2543";

const shapes = new SecretScrub();

/** label, the text a provider might emit, and exactly what it must become. */
const SHAPE_ROWS: readonly [string, string, string][] = [
  ["an OpenAI key", `Incorrect API key provided: ${OPENAI_KEY}`, `Incorrect API key provided: ${REDACTED}`],
  ["an Anthropic key", `invalid x-api-key ${ANTHROPIC_KEY}`, `invalid x-api-key ${REDACTED}`],
  ["a Google key", `API key not valid: ${GOOGLE_KEY}`, `API key not valid: ${REDACTED}`],
  // The `sk-` pattern runs before the `Bearer` one and eats the value first;
  // the key is gone either way, so the next row is what pins `Bearer` itself.
  ["a Bearer-wrapped OpenAI key", `authorization: Bearer ${OPENAI_KEY}`, `authorization: Bearer ${REDACTED}`],
  ["an opaque bearer token", `authorization: Bearer ${OPAQUE_KEY}`, `authorization: ${REDACTED}`],
];

for (const [label, text, expected] of SHAPE_ROWS) {
  void test(`${label} is redacted by shape alone`, () => {
    assert.equal(shapes.text(text), expected);
  });
}

void test("a key with no recognisable shape is redacted by its literal value", () => {
  const opaque = new SecretScrub([OPAQUE_KEY]);
  assert.equal(shapes.text(`rejected token ${OPAQUE_KEY}`).includes(OPAQUE_KEY), true);
  assert.equal(opaque.text(`rejected token ${OPAQUE_KEY}`).includes(OPAQUE_KEY), false);
});

void test("the literal is matched everywhere it appears, not just the first time", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const scrubbed = scrub.text(`${OPAQUE_KEY} and again ${OPAQUE_KEY}`);
  assert.equal(scrubbed, `${REDACTED} and again ${REDACTED}`);
});

void test("no key is too short to redact, and a blank one is not a pattern", () => {
  assert.equal(new SecretScrub(["ab"]).text("a fabulous absolute"), `a f${REDACTED}ulous ${REDACTED}solute`);
  assert.equal(new SecretScrub(["", "   "]).text("nothing to hide"), "nothing to hide");
});

void test("a literal carrying regex metacharacters is escaped, not compiled", () => {
  const scrub = new SecretScrub(["key.+with(specials)"]);
  assert.equal(scrub.text("kexxxwith"), "kexxxwith");
  assert.equal(scrub.text("saw key.+with(specials) here"), `saw ${REDACTED} here`);
});

void test("diagnostic text around the key is preserved", () => {
  const scrubbed = shapes.text(`401 Unauthorized from api.openai.com: ${OPENAI_KEY} is revoked`);
  assert.equal(scrubbed, `401 Unauthorized from api.openai.com: ${REDACTED} is revoked`);
});

void test("a log payload is scrubbed all the way down", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const scrubbed = scrub.payload({
    provider: "openai",
    attempts: [{ header: `Bearer ${OPENAI_KEY}` }, { token: OPAQUE_KEY }],
    status: 401,
    retried: false,
    cause: null,
  });
  assert.equal(JSON.stringify(scrubbed).includes(OPENAI_KEY), false);
  assert.equal(JSON.stringify(scrubbed).includes(OPAQUE_KEY), false);
});

void test("a log payload keeps its shape and its non-string values", () => {
  const scrubbed = shapes.payload({ status: 401, retried: false, cause: null, tags: ["byok"] });
  assert.deepEqual(scrubbed, { status: 401, retried: false, cause: null, tags: ["byok"] });
});

void test("an Error's name and message are scrubbed together", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const text = scrub.errorText(new TypeError(`fetch failed for ${OPAQUE_KEY}`));
  assert.equal(text, `TypeError: fetch failed for ${REDACTED}`);
});

void test("a thrown non-Error is still turned into scrubbed text", () => {
  assert.equal(shapes.errorText(`raw ${GOOGLE_KEY}`), `raw ${REDACTED}`);
  assert.equal(shapes.errorText({ nested: "object" }), "unknown error");
});
