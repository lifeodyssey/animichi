/**
 * The fallback half of `translate_anime_title`: a tool-less model call.
 *
 * Port of `translation.py`'s `translation_agent` × `_translate_title_with_llm`.
 *
 * DECISION (#1287, the card's second): the brief asked for "the turn's model
 * via `createProvider` with `tools: []`". It runs on exactly that model — the
 * one `turn-model.ts` registers through `createProvider`, reused rather than
 * re-created, as Python's sub-agent inherited `ctx.model` (a deployment that
 * swapped its provider would otherwise keep translating on the old one). What
 * differs is the spelling of "tool-less": a `Context` that carries NO `tools`
 * key, rather than one carrying an empty array, and `models.streamSimple`
 * rather than a second `Agent`. Both are the same request on the wire, and
 * omitting the key is the stronger statement — there is no loop, no tool list,
 * and so no way for this call to re-enter the toolbox it was called from.
 *
 * The stream function is injected for the same reason the model is: this module
 * lives in `tools/`, and `tools/` never reaches into `session/` for a registry.
 *
 * Every failure is `null`, never a throw: the caller's next step is an honest
 * `untranslated` result, which is a better answer than a failed tool.
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { TranslationLocale } from "@animichi/contract/agent-tool-parameters";

/** The system prompt of Python's translation agent, word for word. */
const TRANSLATION_INSTRUCTIONS = `You translate anime titles, Japanese place names, and user-facing text between
Japanese, Simplified Chinese, and English.

For anime titles, use the official or community-accepted localized title from
your existing knowledge, never a literal word-by-word rendering. For Japanese
places, use Hepburn romanization and customary English suffixes such as
Station, Shrine, Temple, Park, or Garden. Return only the translated text,
without explanations, provenance labels, confidence scores, or quotes.
`;

/** What the model is asked to translate INTO, in words rather than codes. */
const LOCALE_NAMES: Readonly<Record<TranslationLocale, string>> = {
  ja: "Japanese",
  zh: "Simplified Chinese",
  en: "English",
};

/** How this module reaches a model: pi's own `streamSimple`, injected. */
export type ModelStream = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/** One tool-less completion: a prompt in, the model's own text out, or null. */
export type ToollessCompletion = (prompt: string, signal?: AbortSignal) => Promise<string | null>;

/**
 * The prompt, with the title fenced.
 *
 * The fence is a boundary, and stripping the fence marker out of the title is
 * what keeps it one: a title containing ``` would otherwise close the block and
 * whatever followed would read as instruction. Ported from `_title_prompt`.
 */
function titlePrompt(title: string, targetLanguage: TranslationLocale): string {
  const fenced = title.replaceAll("```", "");
  return `Translate the anime title below to ${LOCALE_NAMES[targetLanguage]}.\n\`\`\`\n${fenced}\n\`\`\`\nReturn the accepted localized name only.`;
}

/** The assistant's own text, joined; empty when it produced none. */
function textOf(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** The completed message's text, or null when the model failed or said nothing. */
async function completed(stream: AssistantMessageEventStream): Promise<string | null> {
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted") return null;
  return textOf(message).trim() || null;
}

/** The one-message context: no `tools` key, so there is nothing to call. */
function translationContext(prompt: string): Context {
  return {
    systemPrompt: TRANSLATION_INSTRUCTIONS,
    // pi requires a timestamp on every message; this context is built, sent and
    // dropped inside one call, so the wall clock is never read back from it.
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };
}

/** A tool-less completion on one model, through one stream function. */
export function toollessCompletion(model: Model<Api>, stream: ModelStream): ToollessCompletion {
  return async (prompt, signal) => {
    try {
      return await completed(stream(model, translationContext(prompt), { signal }));
    } catch (error) {
      console.warn({ event: "translation_model_failed", error: String(error) });
      return null;
    }
  };
}

/** The model's localized title, stripped of the quotes it sometimes adds. */
export async function modelTitle(
  complete: ToollessCompletion,
  title: string,
  targetLanguage: TranslationLocale,
  signal?: AbortSignal,
): Promise<string | null> {
  const translated = await complete(titlePrompt(title, targetLanguage), signal);
  if (translated === null) return null;
  return translated.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "") || null;
}
