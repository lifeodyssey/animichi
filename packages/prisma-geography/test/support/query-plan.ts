import assert from "node:assert/strict";

interface PlanNode {
  readonly nodeType: string;
  readonly indexName?: string;
  readonly indexCondition?: string;
  readonly orderBy?: string;
  readonly children: readonly PlanNode[];
}

interface IndexNodeExpectation {
  readonly indexName: string;
  readonly indexLabel: string;
  readonly condition: RegExp;
  readonly conditionLabel: string;
}

const GIST_EXPECTATION: IndexNodeExpectation = {
  indexName: "geo_points_location_gist_fb41678c",
  indexLabel: "geography GiST",
  condition: /&&/u,
  conditionLabel: "radius condition",
};

const TRIGRAM_EXPECTATION: IndexNodeExpectation = {
  indexName: "geo_points_name_trgm",
  indexLabel: "pg_trgm GIN",
  condition: /%/u,
  conditionLabel: "match predicate",
};

export function assertGistRadiusAndOrder(payload: unknown): void {
  const gist = assertIndexNode(payload, GIST_EXPECTATION);
  assert.match(gist.orderBy ?? "", /<->/u, "the same GiST node must serve KNN ordering");
}

export function assertSequentialScan(payload: unknown): void {
  const sequential = flatten(rootNode(payload)).find((node) => node.nodeType === "Seq Scan");
  assert.ok(sequential, "expected a sequential scan after dropping the index");
}

export function assertTrigramIndex(payload: unknown): void {
  assertIndexNode(payload, TRIGRAM_EXPECTATION);
}

function assertIndexNode(payload: unknown, expected: IndexNodeExpectation): PlanNode {
  const node = flatten(rootNode(payload)).find((candidate) => candidate.indexName === expected.indexName);
  assert.ok(node, `expected the generated query to use the ${expected.indexLabel} index`);
  const unmet = `the ${expected.indexLabel} node must serve the ${expected.conditionLabel}`;
  assert.match(node.indexCondition ?? "", expected.condition, unmet);
  return node;
}

function rootNode(payload: unknown): PlanNode {
  if (!Array.isArray(payload) || !isRecord(payload[0])) throw new TypeError("EXPLAIN JSON must be a one-item array");
  return planNode(payload[0].Plan);
}

function planNode(value: unknown): PlanNode {
  if (!isRecord(value) || typeof value["Node Type"] !== "string") throw new TypeError("EXPLAIN node is malformed");
  return {
    nodeType: value["Node Type"],
    indexName: optionalString(value["Index Name"]),
    indexCondition: optionalString(value["Index Cond"]),
    orderBy: optionalString(value["Order By"]),
    children: Array.isArray(value.Plans) ? value.Plans.map(planNode) : [],
  };
}

function flatten(node: PlanNode): readonly PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
