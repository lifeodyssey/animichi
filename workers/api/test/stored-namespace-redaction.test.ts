import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { FRAMES } from "../src/agent/host/frame-redaction.ts";
import { REVIEWED_VALUE_NAMESPACES } from "../src/agent/host/stored-record-redaction.ts";

/**
 * KeyRedactingStorage against every place pi stores a value or a list: each namespace pi's installed modules store at
 * has reviewed handling here, a redaction rule or a reason to store it as committed. The namespaces come from pi's own
 * shipped source, so a pi upgrade that adds one fails this test until the new namespace is reviewed.
 */

const PI_DIST = fileURLToPath(new URL("dist/", import.meta.resolve("@earendil-works/pi-agent-core/package.json")));
/** pi building a stored address from a literal namespace, as `value("pi.session.name")` does. */
const ADDRESS = /(?<![\w$.])(value|list)\("([^"]+)"/g;

/** The source of each module pi ships, less the conformance suites it ships for testing other stores. */
function piModules(): string[] {
  return readdirSync(PI_DIST, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".js") && !path.split(sep).includes("testing"))
    .map((path) => readFileSync(join(PI_DIST, path), "utf8"));
}

/** The namespaces pi's modules build an address of `kind` at, each once, sorted. */
function namespacesPiStoresAt(kind: "value" | "list"): string[] {
  const calls = piModules().flatMap((source) => [...source.matchAll(ADDRESS)]);
  const namespaces = calls.filter(([, built]) => built === kind).map(([, , namespace = ""]) => namespace);
  return [...new Set(namespaces)].sort();
}

void test("every value namespace and list pi stores at has reviewed redaction handling", () => {
  assert.deepEqual(namespacesPiStoresAt("list"), [FRAMES]);
  assert.deepEqual(namespacesPiStoresAt("value"), [...REVIEWED_VALUE_NAMESPACES].sort());
});
