import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { webSearch } from "@animichi/agent/tools";
import { z } from "zod";
import { executeTool, fixture } from "./native-tool-fixture.ts";

export interface PageResult { title: string; snippet: string; href?: string }

const Recorded = z.object({ results: z.array(z.object({ title: z.string(), body: z.string(), href: z.string(), source_tier: z.string() })) });

function markupText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A result page in the search backend's markup whose titles and snippets carry the given text verbatim. */
function resultPage(results: readonly PageResult[]): string {
  return results.map(({ title, snippet, href = "https://example.test/" }) =>
    `<div class="result"><a class="result__a" href="${markupText(href)}">${markupText(title)}</a><a class="result__snippet">${markupText(snippet)}</a></div>`).join("");
}

/** What `web_search` hands the model, and records, for one scripted result page. */
export async function searchedPage(results: readonly PageResult[]) {
  const { repo, toolContext } = await fixture(() => Promise.reject(new Error("Catalog must not run")));
  toolContext.webFetch = () => Promise.resolve(new Response(resultPage(results)));
  const { message } = await executeTool(toolContext, "web_search", { query: "title" }, [webSearch]);
  await repo.close(BACKGROUND_CONTEXT);
  const [part] = message.content;
  assert.ok(part?.type === "text");
  return { wrapped: part.text, recorded: Recorded.parse(message.details).results };
}
