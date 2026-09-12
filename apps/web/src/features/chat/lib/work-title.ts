import type { Locale } from "../../../i18n/locales";

/** Anything carrying the bilingual title pair (clarify candidates today). */
export type WorkTitleLike = Readonly<{
  id?: string | null;
  title?: string | null;
  title_cn?: string | null;
}>;

export type LocalizedWorkTitle = Readonly<{ primary: string; secondary?: string }>;

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The store's display language decides which title leads (mirrors
 * components/home/PopularRanking): zh readers see the Chinese title first,
 * everyone else sees the original. The other language trails when it adds
 * information; ids are the last-resort label. */
export function localizedWorkTitle(work: WorkTitleLike, locale: Locale): LocalizedWorkTitle {
  const original = clean(work.title);
  const chinese = clean(work.title_cn);
  const primary = (locale === "zh" ? chinese : original) ?? chinese ?? original ?? clean(work.id) ?? "";
  const trailing = locale === "zh" ? original : chinese;
  return trailing !== undefined && trailing !== primary ? { primary, secondary: trailing } : { primary };
}
