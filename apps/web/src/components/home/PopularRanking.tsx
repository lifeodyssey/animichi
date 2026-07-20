import type { PopularBangumi } from "../../api/popular";
import { usePopularRanking } from "../../api/hooks/use-popular";
import type { Dict } from "../../i18n/dictionaries";
import { useDict, useLocale } from "../../i18n/context";
import type { Locale } from "../../i18n/locales";

function rowTitle(row: PopularBangumi, locale: Locale): string {
  return locale === "zh" ? (row.title_cn ?? row.title) : row.title;
}

function RankItem({ row, locale, home }: { readonly row: PopularBangumi; readonly locale: Locale; readonly home: Dict["home"] }) {
  return (
    <li>
      <a className="flex items-baseline gap-3 rounded-xl px-3 py-2 hover:bg-[var(--color-muted)]" href={`/anime/${row.id}`}>
        <span className="font-bold text-[var(--color-fg)]">{rowTitle(row, locale)}</span>
        <span className="ml-auto text-sm text-[var(--color-muted-fg)]">{row.points_count} {home.popular_spots}</span>
      </a>
    </li>
  );
}

function RankList({ rows, home }: { readonly rows: readonly PopularBangumi[]; readonly home: Dict["home"] }) {
  const locale = useLocale();
  return (
    <ol className="m-0 list-none p-0">
      {rows.map((row) => <RankItem key={row.id} row={row} locale={locale} home={home} />)}
    </ol>
  );
}

function RankingBody({ rows, home }: { readonly rows: readonly PopularBangumi[]; readonly home: Dict["home"] }) {
  if (rows.length === 0) return <p className="m-0 text-[var(--color-muted-fg)]">{home.popular_empty}</p>;
  return <RankList rows={rows} home={home} />;
}

function RankingSection({ rows, home }: { readonly rows: readonly PopularBangumi[]; readonly home: Dict["home"] }) {
  return (
    <section aria-labelledby="popular-title" className="rounded-2xl bg-[var(--color-card)] p-4">
      <h2 id="popular-title" className="mt-0 mb-2 text-[var(--color-fg)]">{home.popular_title}</h2>
      <RankingBody rows={rows} home={home} />
    </section>
  );
}

/** "人気ランキング": popular titles from the existing agent endpoint; an empty
 * or failed query degrades to a graceful empty state (spec S5.5). */
export function PopularRanking() {
  const home = useDict().home;
  const query = usePopularRanking();
  if (query.isPending) return <p role="status">{home.popular_title}…</p>;
  return <RankingSection rows={query.isSuccess ? query.data.bangumi : []} home={home} />;
}
