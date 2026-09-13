import assert from "node:assert/strict";

interface PlanNode {
  readonly nodeType: string;
  readonly indexName?: string;
  readonly indexCondition?: string;
  readonly orderBy?: string;
  readonly children: readonly PlanNode[];
}

export function assertGistRadiusAndOrder(payload: unknown): void {
  const nodes = flatten(rootNode(payload));
  const gist = nodes.find((node) => node.indexName === "geo_points_location_gist_fb41678c");
  assert.ok(gist, "expected the generated query to use the geography GiST index");
  assert.match(gist.indexCondition ?? "", /&&/u, "the GiST node must serve the radius condition");
  assert.match(gist.orderBy ?? "", /<->/u, "the same GiST node must serve KNN ordering");
}

export function assertSequentialScan(payload: unknown): void {
  const sequential = flatten(rootNode(payload)).find((node) => node.nodeType === "Seq Scan");
  assert.ok(sequential, "expected a sequential scan after dropping the GiST index");
}

function rootNode(payload: unknown): PlanNode {
  if (!Array.isArray(payload) || !isRecord(payload[0])) throw new TypeError("EXPLAIN JSON must be a one-item array");
  return planNode(payload[0].Plan);
}

function planNode(value: unknown): PlanNode {
  if (!isRecord(value) || typeof value["Node Type"] !== "string") throw new TypeError("EXPLAIN node is malformed");
  const plans = value.Plans;
  return {
    nodeType: value["Node Type"],
    indexName: optionalString(value["Index Name"]),
    indexCondition: optionalString(value["Index Cond"]),
    orderBy: optionalString(value["Order By"]),
    children: Array.isArray(plans) ? plans.map(planNode) : [],
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
