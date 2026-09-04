/**
 * How an anime title becomes a localized one, and where that answer came from.
 *
 * Port of `translation.py::translate_title` with `kind="anime_title"` — the
 * only kind `translate_anime_title` ever passed. The chain is the whole domain
 * rule and it is ordered by AUTHORITY, not by cost: the catalog's curated
 * `title_cn` first, the tool-less model second, and the original text last.
 * Provenance is assigned by us rather than claimed by the model, which is what
 * makes `source` and `confidence` mean anything downstream.
 *
 * Python declared this result twice — `TranslationResult` and the pydantic
 * `TranslateTitleResult` the tool returned. One shape is enough here: the tool
 * hands this object straight back as its `details`.
 *
 * `TitleTranslator` is a port for the same reason Python's
 * `RuntimeDeps.title_translator` was one: a BYOK turn must translate on a
 * SERVER-locked model rather than on the caller's key, and that swap is a
 * different implementation of this one function type, not a flag inside it.
 *
 * That swap is WIRED as of #1289 — `session-turn.ts::translationModel` is the
 * TS `_server_title_translator` (`public_api.py:922`, D18): a caller-keyed turn
 * gets the server-key model, a plain turn gets its own, and a caller-keyed turn
 * with no server key to fall back on answers `untranslated` rather than
 * reaching for the caller's credential.
 */

import type { TranslationLocale } from "@animichi/contract/agent-tool-parameters";
import type { CatalogClient } from "./catalog-client.ts";
import { catalogChineseTitle } from "./catalog-title-translation.ts";
import { modelTitle, type ToollessCompletion } from "./model-title-translation.ts";

/** Who produced the translation — the provenance the model is told about. */
export type TranslationSource = "catalog" | "llm" | "untranslated";

/** A localized title with the provenance the application assigned it. */
export interface TranslationResult {
  original: string;
  translated: string;
  source: TranslationSource;
  confidence: number;
}

/** Translate one anime title into one of the three locales. */
export type TitleTranslator = (
  title: string,
  targetLanguage: TranslationLocale,
  signal?: AbortSignal,
) => Promise<TranslationResult>;

/** Curated data is certain; a model is a good guess; the original is neither. */
const CONFIDENCE: Readonly<Record<TranslationSource, number>> = {
  catalog: 1.0,
  llm: 0.6,
  untranslated: 0.0,
};

/** One result, with the confidence its source carries. */
function translationResult(
  original: string,
  translated: string,
  source: TranslationSource,
): TranslationResult {
  return { original, translated, source, confidence: CONFIDENCE[source] };
}

/** The catalog, then the model, then the title as the user wrote it. */
async function translated(
  catalog: CatalogClient,
  complete: ToollessCompletion,
  title: string,
  targetLanguage: TranslationLocale,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const curated = await catalogChineseTitle(catalog, title, targetLanguage, signal);
  if (curated !== null) return translationResult(title, curated, "catalog");
  const guessed = await modelTitle(complete, title, targetLanguage, signal);
  if (guessed !== null) return translationResult(title, guessed, "llm");
  return translationResult(title, title, "untranslated");
}

/** The translator this turn uses: its catalog, and its own model. */
export function titleTranslator(
  catalog: CatalogClient,
  complete: ToollessCompletion,
): TitleTranslator {
  return (title, targetLanguage, signal) =>
    translated(catalog, complete, title, targetLanguage, signal);
}
