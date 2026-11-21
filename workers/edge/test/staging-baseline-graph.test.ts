// SUT: infra/database-access/reset-staging-baseline.sh — whether the live app marker is a node of
// the repository's migration graph. The shipped reader builds the graph the way Prisma's planner
// does: each `migrations/app/<dir>/migration.json` is one edge, and its `from` and `to` are nodes.
// Each case hands the reader a graph directory of its own; only the marker read is replaced.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import { type Outcome, sourcedResetScript } from "./reset-staging-baseline-script.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const CHAIN = [{ from: null, to: A }, { from: A, to: B }, { from: B, to: C }];

// A graph directory of the case's own: one directory per manifest, named in the chain's order.
const withGraph = <T>(manifests: readonly string[], check: (graph: string) => T): T => {
  const graph = mkdtempSync(join(tmpdir(), "reset-graph-"));
  manifests.forEach((manifest, index) => {
    const step = join(graph, `2026112${String(index)}T0000_step`);
    mkdirSync(step);
    writeFileSync(join(step, "migration.json"), manifest);
  });
  try {
    return check(graph);
  } finally {
    rmSync(graph, { force: true, recursive: true });
  }
};

const edges = (chain: readonly object[]): string[] => chain.map((edge) => JSON.stringify(edge));

const membership = (graph: string, marker: string): Outcome => sourcedResetScript(`
GRAPH_DIR="${graph}"
query() { ROWS="${marker}"; }
if app_marker_in_graph; then echo IN_GRAPH; else echo OFF_GRAPH; fi`);

const placed = (chain: readonly object[], marker: string): string =>
  withGraph(edges(chain), (graph) => membership(graph, marker).stdout);

void test("a marker at the graph's head is a node", () => {
  assert.equal(placed(CHAIN, C), "IN_GRAPH\n");
});

void test("a marker at an earlier node is a node: the migrator moves it forward", () => {
  assert.equal(placed(CHAIN, A), "IN_GRAPH\n");
});

// An empty edge from an old chain's head to the new one puts the old head in the graph as a `from`
// alone, and Prisma then migrates that database instead of refusing it.
void test("a marker only an edge's `from` names is a node", () => {
  assert.equal(placed([{ from: null, to: A }, { from: D, to: A }], D), "IN_GRAPH\n");
});

void test("a marker no edge starts or ends at is no node", () => {
  assert.equal(placed(CHAIN, D), "OFF_GRAPH\n");
});

// rc.23 keeps named refs beside the migrations (`migrations/app/refs/db.json`); a directory without
// a manifest is no edge, so the hash a ref points at is no node unless an edge names it.
void test("a hash only a ref names is no node", () => {
  const outcome = withGraph(edges(CHAIN), (graph) => {
    mkdirSync(join(graph, "refs"));
    writeFileSync(join(graph, "refs", "db.json"), JSON.stringify({ hash: D, invariants: [] }));
    return membership(graph, D);
  });
  assert.equal(outcome.stdout, "OFF_GRAPH\n");
});

void test("a hash Prisma does not write, in capitals, is no node", () => {
  assert.equal(placed(CHAIN, C.toUpperCase()), "OFF_GRAPH\n");
});

// Membership is the whole hash: a node that merely contains the marker is another node.
void test("a node that only contains the marker's hash is not the marker", () => {
  assert.equal(placed([{ from: null, to: `${C}0` }], C), "OFF_GRAPH\n");
});

void test("a marker of two lines is no node, even when one of them is", () => {
  const outcome = withGraph(edges(CHAIN), (graph) => sourcedResetScript(`
GRAPH_DIR="${graph}"
query() { printf -v ROWS '%s\\n%s' x "${C}"; }
if app_marker_in_graph; then echo IN_GRAPH; else echo OFF_GRAPH; fi`));
  assert.equal(outcome.stdout, "OFF_GRAPH\n");
});

// The guard the upgrade needs: the marker the migrator writes when it applies the committed chain is
// the contract's storage hash, and the graph the script reads from the same tree must carry it.
// Spelled differently on either side, every deploy after a rebuild would be refused.
void test("the committed graph carries the marker the committed chain's apply writes", () => {
  const contract = fileURLToPath(new URL("../../../packages/pi-session-neon/src/contract.json", import.meta.url));
  const { storage } = JSON.parse(readFileSync(contract, "utf8")) as { storage: { storageHash: string } };
  const outcome = sourcedResetScript(`
query() { ROWS="${storage.storageHash}"; }
if app_marker_in_graph; then echo IN_GRAPH; else echo OFF_GRAPH; fi`);
  assert.equal(outcome.stderr, "");
  assert.equal(outcome.stdout, "IN_GRAPH\n");
});

const assertRefusedGraph = (outcome: Outcome, why: RegExp): void => {
  assert.equal(outcome.status, 1);
  assert.doesNotMatch(outcome.stdout, /IN_GRAPH|OFF_GRAPH/);
  assert.match(outcome.stderr, why);
};

void test("a graph directory with no manifest refuses by name, never answering either way", () => {
  const outcome = withGraph([], (graph) => membership(graph, C));
  assertRefusedGraph(outcome, /^refusing reset: \S+ holds no migration, so the live marker cannot be placed in its graph\n$/);
});

// Prisma reads one edge from each manifest; one that does not hold exactly one is refused by its path.
const NOT_ONE_EDGE = /refusing reset: \S+\/migration\.json is not one migration edge, so the live marker cannot be placed in its graph\n$/;

void test("a manifest that is not JSON refuses by name", () => {
  const outcome = withGraph([...edges(CHAIN), "{"], (graph) => membership(graph, C));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});

void test("a manifest whose `to` is not a hash string refuses by name", () => {
  const outcome = withGraph([...edges(CHAIN), JSON.stringify({ from: C, to: 42 })], (graph) => membership(graph, C));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});

void test("a manifest whose `from` is not a hash string refuses by name", () => {
  const outcome = withGraph([...edges(CHAIN), JSON.stringify({ from: { hash: C }, to: D })], (graph) => membership(graph, D));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});

// Read as no edge, an empty manifest at the edge into the live marker would make that marker look
// like an old chain's, and the run would offer the owner's rebuild record for the wrong reason.
void test("an empty manifest at the edge into the live marker refuses by name, for the graph", () => {
  const outcome = withGraph([...edges(CHAIN.slice(0, 2)), ""], (graph) => membership(graph, C));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});

void test("a manifest of blank lines refuses by name", () => {
  const outcome = withGraph([...edges(CHAIN), " \n\t\n"], (graph) => membership(graph, C));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});

void test("a manifest holding two edges refuses by name", () => {
  const twoEdges = `${JSON.stringify({ from: B, to: C })}\n${JSON.stringify({ from: C, to: D })}\n`;
  const outcome = withGraph([...edges(CHAIN.slice(0, 2)), twoEdges], (graph) => membership(graph, D));
  assertRefusedGraph(outcome, NOT_ONE_EDGE);
});
