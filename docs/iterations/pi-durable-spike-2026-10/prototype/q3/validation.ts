/**
 * Question 3, `validation`: what each of our seven tools receives when the model sends a number where its schema says
 * string, under today's validator and under pi-durable's. One schema object per tool, built with typebox 1.3.32 exactly
 * as `packages/agent/src/<tool>.ts` builds it, goes to both:
 * - pi-ai 0.87.1's `validateToolArguments`, which 0.87.1's harness runs before `execute`
 *   (`@earendil-works/pi-agent-core@0.87.1 dist/harness/execution/tools.js:29`);
 * - pi-ai 1.5.2's, which pi-durable's tool task runs (`@earendil-works/pi-durable@1.5.2 dist/harness/tool.js:5,261`) and
 *   which takes any JSON Schema, TypeBox's included (`@earendil-works/pi-ai@1.5.2 dist/utils/validation.js:40-48`).
 * One extra row sends a string where search_nearby's schema says integer.
 */
import { validateToolArguments as piDurableValidate } from "@earendil-works/pi-ai/utils/validation";
import { validateToolArguments as todayValidate } from "pi-ai-0871/utils/validation";
import { Type } from "typebox";

interface ToolUnderTest {
  readonly name: string;
  readonly source: string;
  readonly parameters: object;
  readonly valid: Record<string, unknown>;
  readonly strings: readonly string[];
}

const TOOLS: readonly ToolUnderTest[] = [
  { name: "resolve_anime", source: "packages/agent/src/resolve-anime.ts:7", strings: ["title"], valid: { title: "Hyouka" },
    parameters: Type.Object({ title: Type.String({ pattern: "\\S" }) }, { additionalProperties: false }) },
  { name: "translate_anime_title", source: "packages/agent/src/translate-anime-title.ts:8", strings: ["title"], valid: { title: "Hyouka", target_language: "zh" },
    parameters: Type.Object({ title: Type.String({ pattern: "\\S", maxLength: 500 }), target_language: Type.Union([Type.Literal("ja"), Type.Literal("zh"), Type.Literal("en")]) }, { additionalProperties: false }) },
  { name: "web_search", source: "packages/agent/src/web-search.ts:6", strings: ["query"], valid: { query: "Hyouka Takayama" },
    parameters: Type.Object({ query: Type.String({ pattern: "\\S", maxLength: 500 }) }, { additionalProperties: false }) },
  { name: "search_bangumi", source: "packages/agent/src/search-bangumi.ts:6", strings: ["bangumi_id"], valid: { bangumi_id: "1556" },
    parameters: Type.Object({ bangumi_id: Type.String({ pattern: "^[0-9]+$" }) }, { additionalProperties: false }) },
  { name: "search_nearby", source: "packages/agent/src/search-nearby.ts:8", strings: ["location"], valid: { location: "Takayama" },
    parameters: Type.Object({ location: Type.Optional(Type.String({ pattern: "\\S" })), radius_m: Type.Optional(Type.Integer({ exclusiveMinimum: 0 })) }, { additionalProperties: false }) },
  { name: "plan_route", source: "packages/agent/src/plan-route.ts:6-7", strings: ["search_result_ref"], valid: { search_result_ref: "ref-1" },
    parameters: Type.Object({ search_result_ref: Type.String({ minLength: 1 }), pacing: Type.Optional(Type.Union([Type.Literal("chill"), Type.Literal("normal"), Type.Literal("packed")])) }, { additionalProperties: false }) },
  { name: "respond", source: "packages/agent/src/respond.ts:9-10", strings: ["message", "reason"], valid: { kind: "qa", message: "Takayama." },
    parameters: Type.Object({ kind: Type.Union([Type.Literal("search"), Type.Literal("route"), Type.Literal("clarify"), Type.Literal("greeting"), Type.Literal("qa")]),
      message: Type.String({ pattern: "\\S" }), reason: Type.Optional(Type.String({ pattern: "\\S" })) }, { additionalProperties: false }) },
];

type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };
type Validate = (tool: { name: string; parameters: object }, call: { id: string; name: string; arguments: Record<string, unknown> }) => unknown;

function outcome(validate: Validate, tool: ToolUnderTest, args: Record<string, unknown>): Outcome {
  try {
    return { ok: true, value: validate({ name: tool.name, parameters: tool.parameters }, { id: "call-1", name: tool.name, arguments: args }) };
  } catch (error) {
    return { ok: false, error: (error instanceof Error ? error.message : String(error)).split("\n").slice(0, 2).join(" ") };
  }
}

export function validationRows() {
  const cases = TOOLS.flatMap((tool) => tool.strings.map((property) => ({ tool, property, args: { ...tool.valid, [property]: 42 }, expects: "string" })));
  const nearby = TOOLS.find((tool) => tool.name === "search_nearby") as ToolUnderTest;
  cases.push({ tool: nearby, property: "radius_m", args: { radius_m: "500" }, expects: "integer" });
  return cases.map(({ tool, property, args, expects }) => {
    const today = outcome(todayValidate as Validate, tool, args);
    const piDurable = outcome(piDurableValidate as Validate, tool, args);
    return { tool: tool.name, source: tool.source, property, schemaSays: expects, sent: args, today, piDurable,
      same: JSON.stringify(today) === JSON.stringify(piDurable) };
  });
}
