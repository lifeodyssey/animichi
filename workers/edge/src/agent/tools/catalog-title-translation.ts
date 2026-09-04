/**
 * The authoritative half of `translate_anime_title`: the catalog's own Chinese
 * title.
 *
 * Port of `translation.py::_catalog_zh_title` × `_resolved_title_cn`. It answers
 * for exactly one case — an anime title asked for in Chinese — because that is
 * the only case where a curated answer EXISTS: `title_cn` is a column, and a
 * column beats a model. Every other locale falls through to the model path, as
 * it did in Python.
 *
 * Three guards, all ported rather than invented:
 *   - only a `resolved` outcome counts. A disambiguation is several works, and
 *     translating one of them at random would be a guess wearing provenance.
 *   - `looksLikeWrongVariant` rejects a match that is a different entry in the
 *     same series (the sequel-vs-original trap `title-variant-conflict.ts`
 *     exists for), because a confidently wrong sequel title is worse than a
 *     model's honest attempt.
 *   - a blank `title_cn` is no title. The catalog stores an empty string for a
 *     work nobody localized.
 *
 * A catalog outage is not an error here: the model path is a complete answer,
 * so EVERY failure degrades to `null` and the tool never sees it. That includes
 * an elapsed deadline — the tool itself is what refuses to call an ended turn
 * "untranslated" (`translate-title-tool.ts`), so this half does not need to
 * tell one failure from another.
 */

import type { CatalogClient } from "./catalog-client.ts";
import { looksLikeWrongVariant } from "./title-variant-conflict.ts";

/** The one locale the catalog is authoritative for. */
const CATALOG_LOCALE = "zh";

/** The resolved match's Chinese title, when it is one we may use. */
async function resolvedTitleCn(
  catalog: CatalogClient,
  title: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const outcome = await catalog.resolve(title, signal);
  if (outcome.outcome !== "resolved") return null;
  const { match } = outcome;
  if (looksLikeWrongVariant(title, [match.title, match.title_cn])) return null;
  return (match.title_cn ?? "").trim() || null;
}

/**
 * The catalog's Chinese title for this work, or `null` — including when the
 * catalog could not answer at all.
 */
export async function catalogChineseTitle(
  catalog: CatalogClient,
  title: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (targetLanguage !== CATALOG_LOCALE) return null;
  try {
    return await resolvedTitleCn(catalog, title, signal);
  } catch (error) {
    console.warn({ event: "translation_catalog_failed", error: String(error) });
    return null;
  }
}
