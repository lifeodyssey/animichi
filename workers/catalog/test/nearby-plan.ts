/**
 * The nearby query's PLAN, read from the statement the adapter really issues.
 *
 * `EXPLAIN` needs the statement text AND its parameters — so the plan assertions
 * in `nearby-metric.integration.test.ts` cannot run against a hand-written mirror
 * of the adapter's SQL, which drifts from it silently. The production serverless
 * client builds its own `pg.Client` with no seam to record, but it does accept a
 * middleware, and `beforeQuery` runs after lowering and before the driver: that
 * is the statement, from the same entry the Worker uses, with the parameters the
 * runtime was about to bind.
 *
 * Parameters are re-rendered for `EXPLAIN`: scalars pass through, and a geography
 * point becomes the EWKT text its codec encodes to — the exact string the
 * serverless driver binds for this statement, which the statement's own
 * `::geography` casts then type.
 *
 * The middleware's parameter type is left to inference on purpose: the plan type
 * lives in `@prisma/orm-family-sql`, which this package does NOT declare, and the
 * isolated linker refuses an undeclared import rather than hoisting a neighbour's
 * copy (`pnpm-workspace.yaml`, #1730).
 */
import type { GeographyPoint } from "@animichi/prisma-geography";
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import postgresServerless from "@prisma/orm-postgres/serverless";
import pg from "pg";
import type { CatalogPrisma } from "../src/db/prisma";

/** One statement as the runtime lowered it, with its pre-encoding parameters. */
interface RecordedStatement {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** The query seam under capture, and how to read the plan back out of it. */
export interface NearbyPlanCapture {
  /** Built by the nearby adapter, executed by the production serverless entry. */
  readonly prisma: CatalogPrisma;
  /** `EXPLAIN (FORMAT JSON)` of the last recorded statement containing `needle`. */
  explain(needle: string): Promise<readonly PlanNode[]>;
  /** Every statement the seam lowered, in call order — the drift tripwire. */
  recordedSql(): readonly string[];
  close(): Promise<void>;
}

/** One `EXPLAIN (FORMAT JSON)` node, with the fields a plan assertion reads. */
export interface PlanNode {
  node: string;
  index?: string;
  indexCondition?: string;
  filter?: string;
  sortKey?: readonly string[];
  children: readonly PlanNode[];
}

/** Open the capture against `dsn`, and an `EXPLAIN` connection beside it. */
export async function captureNearbyPlan(dsn: string): Promise<NearbyPlanCapture> {
  const recorded: RecordedStatement[] = [];
  const client = postgresServerless<Contract>({
    contractJson,
    extensions: [geographyRuntimeDescriptor],
    middleware: [{
      name: "nearby-plan-capture",
      beforeQuery: (plan) => {
        recorded.push({ text: plan.sql, params: plan.params });
      },
    }],
  });
  const runtime = await client.connect({ url: dsn });
  const explainer = new pg.Client({ connectionString: dsn });
  await explainer.connect();
  return {
    prisma: { builder: client.sql, executor: runtime },
    explain: (needle) => explainRecorded(explainer, recorded, needle),
    recordedSql: () => recorded.map((entry) => entry.text),
    close: async () => {
      await explainer.end();
      await runtime[Symbol.asyncDispose]();
    },
  };
}

/** `EXPLAIN (FORMAT JSON)` of the last recorded statement containing `needle`. */
async function explainRecorded(
  explainer: pg.Client,
  recorded: readonly RecordedStatement[],
  needle: string,
): Promise<readonly PlanNode[]> {
  const statement = [...recorded].reverse().find((entry) => entry.text.includes(needle));
  if (statement === undefined) throw new Error(`no recorded statement contains ${needle}`);
  const { rows } = await explainer.query<{ readonly "QUERY PLAN": unknown }>(
    `EXPLAIN (FORMAT JSON) ${statement.text}`,
    statement.params.map(bindable),
  );
  return flattenPlan(rootPlan(rows[0]?.["QUERY PLAN"]));
}

/** A parameter as `pg` can bind it: scalars as they are, a geography as EWKT. */
function bindable(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "string") return value;
  if (!isGeographyPoint(value)) throw new TypeError("unsupported plan parameter");
  const [longitude, latitude] = value.coordinates;
  return `SRID=${String(value.srid)};POINT(${String(longitude)} ${String(latitude)})`;
}

/** The pack's point VALUE, recognised structurally (the pack is the only source). */
function isGeographyPoint(value: unknown): value is GeographyPoint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GeographyPoint>;
  return typeof candidate.srid === "number" && Array.isArray(candidate.coordinates);
}

/** The plan root of an `EXPLAIN (FORMAT JSON)` payload. */
function rootPlan(payload: unknown): PlanNode {
  if (!Array.isArray(payload) || !isRecord(payload[0])) throw new TypeError("EXPLAIN payload is malformed");
  return planNode(payload[0].Plan);
}

/** The node and every descendant, in plan order. */
function flattenPlan(root: PlanNode): readonly PlanNode[] {
  return [root, ...root.children.flatMap(flattenPlan)];
}

/** One plan node plus its children. */
function planNode(value: unknown): PlanNode {
  if (!isRecord(value)) throw new TypeError("EXPLAIN node is malformed");
  return listedNode(value);
}

/** A plan node's own fields, with its children read recursively. */
function listedNode(node: Readonly<Record<string, unknown>>): PlanNode {
  if (typeof node["Node Type"] !== "string") throw new TypeError("EXPLAIN node is malformed");
  return {
    node: node["Node Type"],
    index: optionalString(node["Index Name"]),
    indexCondition: optionalString(node["Index Cond"]),
    filter: optionalString(node.Filter),
    sortKey: optionalStrings(node["Sort Key"]),
    children: Array.isArray(node.Plans) ? node.Plans.map(planNode) : [],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStrings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}
