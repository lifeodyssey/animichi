/**
 * `translate_anime_title` — a title in one language, the accepted title in
 * another, with provenance.
 *
 * Port of `apps/agent/src/animichi/agents/web_tools.py::translate_anime_title`.
 * The description is that docstring, kept word-for-word: it is the only thing
 * that stops the model translating titles itself, which is the whole reason the
 * tool exists.
 *
 * Everything interesting is behind `TitleTranslator` (`title-translation.ts`) —
 * the catalog-first chain, the provenance and the confidences. This file is the
 * tool: a name, a description, the emitted parameters, and the deadline.
 *
 * It cannot fail into an error result. `titleTranslator` degrades a catalog
 * outage and a model failure into `untranslated`, so the only throw that can
 * escape here is the deadline — and that one MUST escape. `untranslated` is a
 * claim ("we tried both paths and neither had this title"), and a turn that ran
 * out of budget has not earned it; pi reads the throw as the turn ending, which
 * is what actually happened.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { toolExecutionBudget, type ToolBudget } from "./catalog-timeouts.ts";
import type { ToolDetails } from "./catalog-tool-outcomes.ts";
import { outcomeToolResult } from "./outcome-tool-result.ts";
import type { TitleTranslator, TranslationResult } from "./title-translation.ts";
import type { TranslateAnimeTitleParameters } from "@animichi/contract/agent-tool-parameters";
import { translateAnimeTitleParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = `Translate an anime title through catalog or tool-less localization.

Chinese titles resolve through the authoritative catalog. English, Japanese, and catalog misses use a tool-less translation model.

IMPORTANT: Always use this tool when you need to show an anime title in a different language from the original. Do not guess translations.

Returns the original title, the translated text, the provenance source (catalog|llm|untranslated), and a confidence between 0.0 and 1.0.`;

/**
 * The translation, unless the deadline passed while it was being made.
 *
 * The title is passed EXACTLY as the model wrote it, unlike `resolve_anime`
 * which trims. Python did not trim here either, and the difference is not an
 * oversight in one of them: `resolve_anime`'s trim exists because the padded
 * string would be sent to the catalog as a search query, whereas this title is
 * echoed back as `original` and rendered into a prompt. Trimming it would
 * change what the model is told it asked about. The one place padding could
 * matter — the catalog lookup — is covered by `ResolveInput.query`'s own zod
 * `.trim()` on the catalog side.
 */
async function translated(
  translate: TitleTranslator,
  params: TranslateAnimeTitleParameters,
  deadline: AbortSignal,
): Promise<TranslationResult> {
  const result = await translate(params.title, params.target_language, deadline);
  deadline.throwIfAborted();
  return result;
}

/** Build `translate_anime_title` over one turn's translator. */
export function translateTitleTool(
  translate: TitleTranslator,
  budget: ToolBudget = toolExecutionBudget,
): AgentTool<typeof translateAnimeTitleParameters, ToolDetails<TranslationResult>> {
  return {
    name: "translate_anime_title",
    label: "Translate an anime title",
    description: DESCRIPTION,
    parameters: translateAnimeTitleParameters,
    // The same 85-second ceiling the catalog tools run under: this one can make
    // a catalog call AND a model call, so it is the tool with the most ways to
    // hang, and pi enforces no per-tool deadline of its own.
    execute: async (_toolCallId, params, signal) =>
      outcomeToolResult(await translated(translate, params, budget(signal))),
  };
}
