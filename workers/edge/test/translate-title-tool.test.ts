/**
 * W2-1 (#1287): `translate_anime_title`, case for case with
 * `apps/agent/src/animichi/tests/unit/test_translation.py`.
 *
 * The claim is provenance. The catalog is authoritative for exactly one case —
 * a Chinese anime title — the model answers the rest, and the original text is
 * the honest last resort; `source` and `confidence` say which happened, and are
 * assigned by us rather than claimed by the model.
 *
 * The model is a scripted completion rather than a mock of pi: what matters is
 * what the chain does with an answer, a refusal, and silence.
 *
 * test-type: unit (no clock, no network, no model).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ResolveOutcome } from "@animichi/contract";
import type { CatalogClient } from "../src/agent/tools/catalog-client.ts";
import { titleTranslator } from "../src/agent/tools/title-translation.ts";
import { translateTitleTool } from "../src/agent/tools/translate-title-tool.ts";
import type { ToollessCompletion } from "../src/agent/tools/model-title-translation.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";
import { spentBudget, unspentBudget } from "./doubles/make-tool-budget.ts";

/** The catalog knows no such work. */
const NOT_FOUND: ResolveOutcome = { outcome: "not_found", reason: "anime_not_found" };

/** One resolved work, as the catalog answers for it. */
function makeResolved(title: string, titleCn: string): ResolveOutcome {
  return {
    outcome: "resolved" as const,
    match: { bangumi_id: "1", title, title_cn: titleCn, points_count: 1 },
  };
}

/** A completion that always answers with the same text. */
function completionSaying(text: string | null): ToollessCompletion {
  return () => Promise.resolve(text);
}

/** The translation one call produced, through the tool the model calls. */
async function translated(
  resolve: ResolveOutcome,
  complete: ToollessCompletion,
  args: { title: string; target_language: "ja" | "zh" | "en" },
  budget = unspentBudget,
) {
  const { catalog } = scriptedCatalog({ resolve });
  const tool = translateTitleTool(titleTranslator(catalog, complete), budget);
  const result = await tool.execute("call-1", args, undefined);
  return result.details;
}

void test("a Chinese title comes from the catalog, and the model is never asked", async () => {
  let asked = false;
  const complete: ToollessCompletion = () => {
    asked = true;
    return Promise.resolve("模型的猜测");
  };
  const details = await translated(makeResolved("君の名は。", "你的名字。"), complete, {
    title: "君の名は。",
    target_language: "zh",
  });
  assert.deepEqual(details, {
    original: "君の名は。",
    translated: "你的名字。",
    source: "catalog",
    confidence: 1,
  });
  assert.equal(asked, false);
});

void test("every other locale is the model's, with the model's own confidence", async () => {
  const details = await translated(makeResolved("君の名は。", "你的名字。"), completionSaying("Your Name"), {
    title: "君の名は。",
    target_language: "en",
  });
  assert.deepEqual(details, {
    original: "君の名は。",
    translated: "Your Name",
    source: "llm",
    confidence: 0.6,
  });
});

void test("a catalog miss falls through to the model rather than answering wrongly", async () => {
  const details = await translated(NOT_FOUND, completionSaying("你的名字。"), {
    title: "君の名は。",
    target_language: "zh",
  });
  assert.equal(details.source, "llm");
});

void test("a work with no Chinese title in the catalog is the model's too", async () => {
  const details = await translated(makeResolved("Yuru Camp", "  "), completionSaying("摇曳露营"), {
    title: "Yuru Camp",
    target_language: "zh",
  });
  assert.equal(details.source, "llm");
});

void test("a different entry in the same series is not this work's title", async () => {
  const sequel = makeResolved("鬼滅の刃", "鬼灭之刃");
  const details = await translated(sequel, completionSaying("鬼灭之刃 无限列车篇"), {
    title: "鬼滅の刃 無限列車編",
    target_language: "zh",
  });
  assert.equal(details.source, "llm");
});

void test("a silent model leaves the title untranslated, and says so", async () => {
  const details = await translated(NOT_FOUND, completionSaying(null), {
    title: "君の名は。",
    target_language: "en",
  });
  assert.deepEqual(details, {
    original: "君の名は。",
    translated: "君の名は。",
    source: "untranslated",
    confidence: 0,
  });
});

void test("the quotes a model wraps its answer in are not part of the title", async () => {
  const details = await translated(NOT_FOUND, completionSaying('"Your Name"'), {
    title: "君の名は。",
    target_language: "en",
  });
  assert.equal(details.translated, "Your Name");
});

void test("the title is echoed back exactly as the model wrote it", async () => {
  const details = await translated(NOT_FOUND, completionSaying("Your Name"), {
    title: " 君の名は。 ",
    target_language: "en",
  });
  assert.equal(details.original, " 君の名は。 ");
});

void test("a catalog outage is the model's cue, not the tool's failure", async () => {
  const { catalog } = scriptedCatalog({});
  const tool = translateTitleTool(titleTranslator(catalog, completionSaying("你的名字。")), unspentBudget);
  const result = await tool.execute("call-1", { title: "君の名は。", target_language: "zh" }, undefined);
  assert.equal(result.details.source, "llm");
});

/** A catalog that fails the way a real one does when its request is aborted. */
function catalogAbortingOn(signal: AbortSignal): CatalogClient {
  const aborted = (): Promise<never> => Promise.reject(signal.reason as Error);
  return {
    resolve: aborted,
    pointsByBangumiId: aborted,
    nearby: aborted,
    geocode: aborted,
    planItinerary: aborted,
  };
}

void test("an aborted catalog request ends the turn instead of starting a model call", async () => {
  const turn = AbortSignal.abort();
  let asked = false;
  const complete = () => {
    asked = true;
    return Promise.resolve("Your Name");
  };
  const tool = translateTitleTool(titleTranslator(catalogAbortingOn(turn), complete), unspentBudget);
  await assert.rejects(tool.execute("call-1", { title: "君の名は。", target_language: "zh" }, turn));
  assert.equal(asked, false, "the model must not be called after the deadline has passed");
});

void test("a spent budget ends the turn rather than claiming the title is untranslatable", async () => {
  await assert.rejects(
    translated(NOT_FOUND, completionSaying(null), {
      title: "君の名は。",
      target_language: "en",
    }, spentBudget),
  );
});
