import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANSWER_KINDS,
  CATALOG_TOOL_PARAMETERS,
  TRANSLATION_LOCALES,
  WEB_TOOL_PARAMETERS,
} from "../src/agent-tool-parameters.js";
import {
  ANSWER_TOOL_NAME,
  ANSWER_TOOL_SCHEMA,
  CATALOG_TOOL_SCHEMAS,
  CHAT_RESPONSE_INTENTS,
  WEB_TOOL_SCHEMAS,
} from "../src/agent-tool-schemas.js";
import { ChatResponseDataPart } from "../src/chat-data-parts.js";
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

  it("forbids a whitespace-only title, as the catalog's own `.trim().min(1)` does", () => {
    expect(CATALOG_TOOL_SCHEMAS.resolve_anime.properties.title?.pattern).toBe("\\S");
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

describe("the answer tool seam (#1283)", () => {
  it("names the tool once, where the Worker can read it without zod", () => {
    expect(ANSWER_TOOL_NAME).toBe("respond");
  });

  it("offers the model Python's own output vocabulary and nothing wider", () => {
    expect(ANSWER_TOOL_SCHEMA.properties.kind?.enum).toStrictEqual([...ANSWER_KINDS]);
  });

  it("requires a kind and a non-blank message, and refuses invented parameters", () => {
    expect(ANSWER_TOOL_SCHEMA.required).toStrictEqual(["kind", "message"]);
    expect(ANSWER_TOOL_SCHEMA.properties.message?.pattern).toBe("\\S");
    expect(ANSWER_TOOL_SCHEMA.additionalProperties).toBe(false);
  });

  it("emits the intent vocabulary the response union itself declares", () => {
    const declared = ChatResponseDataPart.options.map((option) => option.shape.intent.value);
    expect([...CHAT_RESPONSE_INTENTS]).toStrictEqual(declared);
  });
});

describe("the web tool schema seam (#1287)", () => {
  it("emits one schema per declared web tool", () => {
    expect(Object.keys(WEB_TOOL_SCHEMAS)).toStrictEqual(Object.keys(WEB_TOOL_PARAMETERS));
  });

  it("forbids a whitespace-only search query, the way Python's tools rejected one", () => {
    expect(WEB_TOOL_SCHEMAS.web_search.properties.query?.pattern).toBe("\\S");
    expect(WEB_TOOL_SCHEMAS.web_search.required).toStrictEqual(["query"]);
  });

  it("offers the model the three locales Python translated between, and no fourth", () => {
    expect(WEB_TOOL_SCHEMAS.translate_anime_title.properties.target_language?.enum).toStrictEqual([
      ...TRANSLATION_LOCALES,
    ]);
  });

  it("requires both of translate_anime_title's arguments and refuses invented ones", () => {
    const schema = WEB_TOOL_SCHEMAS.translate_anime_title;
    expect(schema.required).toStrictEqual(["title", "target_language"]);
    expect(schema.additionalProperties).toBe(false);
    expect(WEB_TOOL_SCHEMAS.web_search.additionalProperties).toBe(false);
  });
});
