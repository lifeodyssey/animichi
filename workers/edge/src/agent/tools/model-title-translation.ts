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
 *
 * WHAT IT SPENT leaves through a sink (#1292). This call is made from inside a
 * tool rather than by the loop, so its `message_end` never reaches the pi
 * Agent and `TurnOutput` cannot see the tokens — they were metered nowhere at
 * all before this. Python solved it the same way, handing the translation its
 * own `RunUsage` and attributing the total afterwards
 * (`interfaces/public_api.py::_server_title_translator`); returning the usage
 * instead would have to travel back through `TranslationResult`, which is the
 * object the tool hands the MODEL.
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
import type { UsageSink } from "../settlement/supplemental-usage.ts";

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

/**
 * The completed message's text, or null when the model failed or said nothing —
 * and, either way, what the provider says it cost.
 *
 * A generation that ended in `error` or `aborted` is still reported: the
 * request reached the provider and came back carrying its own usage, so the
 * tokens are spent whether or not they became a translation. Only a stream
 * that THREW reports nothing, because there is no message to read a figure off.
 */
async function completed(
  stream: AssistantMessageEventStream,
  spent: UsageSink,
): Promise<string | null> {
  const message = await stream.result();
  spent({ requests: 1, inputTokens: message.usage.input, outputTokens: message.usage.output });
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

/** A tool-less completion on one model, through one stream function, reporting
 * what it spends to `spent`. */
export function toollessCompletion(
  model: Model<Api>,
  stream: ModelStream,
  spent: UsageSink,
): ToollessCompletion {
  return async (prompt, signal) => {
    try {
      return await completed(stream(model, translationContext(prompt), { signal }), spent);
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
