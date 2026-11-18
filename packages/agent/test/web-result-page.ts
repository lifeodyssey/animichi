import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { z } from "zod";
import { executePilgrimageTool, fixture } from "./native-tool-fixture.ts";

export interface PageResult { title: string; snippet: string; href?: string }

const Recorded = z.object({ results: z.array(z.object({ title: z.string(), body: z.string(), href: z.string(), source_tier: z.string() })) });

function markupText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A result page in the search backend's markup whose titles and snippets carry the given text verbatim. */
export function resultPage(results: readonly PageResult[]): string {
  return results.map(({ title, snippet, href = "https://example.test/" }) =>
    `<div class="result"><a class="result__a" href="${markupText(href)}">${markupText(title)}</a><a class="result__snippet">${markupText(snippet)}</a></div>`).join("");
}

/** The `web_search` result entry the production harness stores when the search backend answers with `response`. */
export async function storedSearch(response: Response) {
  const { repo, toolContext } = await fixture(() => Promise.reject(new Error("Catalog must not run")));
  toolContext.webFetch = () => Promise.resolve(response);
  const { message } = await executePilgrimageTool(toolContext, "web_search", { query: "title" });
  await repo.close(BACKGROUND_CONTEXT);
  return message;
}

/** What `web_search` hands the model, and records, for one scripted result page. */
export async function searchedPage(results: readonly PageResult[]) {
  const message = await storedSearch(new Response(resultPage(results)));
  const [part] = message.content;
  assert.ok(part?.type === "text");
  return { wrapped: part.text, recorded: Recorded.parse(message.details).results };
}
