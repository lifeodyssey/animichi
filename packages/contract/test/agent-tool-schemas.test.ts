import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG_TOOL_PARAMETERS } from "../src/agent-tool-parameters.js";
import { CATALOG_TOOL_SCHEMAS } from "../src/agent-tool-schemas.js";
import { TOOL_SCHEMA_MODULE_PATH, toolSchemaModule } from "../scripts/emit-tool-schemas.js";

describe("the catalog tool schema seam", () => {
  it("keeps the committed module byte-identical to a fresh emission", () => {
    expect(readFileSync(TOOL_SCHEMA_MODULE_PATH, "utf8")).toBe(toolSchemaModule());
  });

  it("emits one schema per declared tool", () => {
    expect(Object.keys(CATALOG_TOOL_SCHEMAS)).toStrictEqual(Object.keys(CATALOG_TOOL_PARAMETERS));
  });

  it("carries the catalog's own bangumi id constraint, not a second copy", () => {
    expect(CATALOG_TOOL_SCHEMAS.search_bangumi.properties.bangumi_id?.pattern).toBe("^\\d+$");
  });

  it("carries the catalog's own pacing vocabulary", () => {
    expect(CATALOG_TOOL_SCHEMAS.plan_route.properties.pacing?.enum).toStrictEqual([
      "chill",
      "normal",
      "packed",
    ]);
  });

  it("rejects arguments the model invents beyond the declared parameters", () => {
    const schemas = Object.values(CATALOG_TOOL_SCHEMAS);
    expect(schemas.map((schema) => schema.additionalProperties)).toStrictEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("requires only what Python required", () => {
    const required = Object.entries(CATALOG_TOOL_SCHEMAS).map(([name, schema]) => [name, schema.required ?? []]);
    expect(required).toStrictEqual([
      ["resolve_anime", ["title"]],
      ["search_bangumi", ["bangumi_id"]],
      ["search_nearby", []],
      ["plan_route", ["search_result_ref"]],
    ]);
  });
});
