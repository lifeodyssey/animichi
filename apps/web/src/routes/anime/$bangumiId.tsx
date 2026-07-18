import { createFileRoute, notFound } from "@tanstack/react-router";
import { resolveOrigin } from "../../api/config";
import { animeOverviewOptions, useAnimeOverview } from "../../api/hooks/use-anime-overview";
import { AnimePage } from "../../features/anime/AnimePage";
import { animeHead } from "../../features/anime/head";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../../i18n/locales";

const BANGUMI_ID_PATTERN = /^\d+$/;

/** A real `Error` carrying TanStack's not-found marker (`isNotFound: true`). */
function notFoundError(): Error {
  return Object.assign(new Error("unknown anime id"), notFound());
}

interface AnimeSearch {
  readonly hl?: Locale;
}

function parseSearch(search: Record<string, unknown>): AnimeSearch {
  const hl = search.hl;
  if (typeof hl === "string" && (LOCALES as readonly string[]).includes(hl)) {
    return { hl: hl as Locale };
  }
  return {};
}

/** Absolute origin for hreflang hrefs; relative fallback beats an SSR crash. */
function siteOrigin(): string {
  const location = typeof window === "undefined" ? undefined : window.location;
  try {
    return resolveOrigin(import.meta.env, location);
  } catch {
    return "";
  }
}

export const Route = createFileRoute("/anime/$bangumiId")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ hl: search.hl }),
  loader: async ({ params, deps, context }) => {
    if (!BANGUMI_ID_PATTERN.test(params.bangumiId)) throw notFoundError();
    await context.queryClient.ensureQueryData(animeOverviewOptions(params.bangumiId));
    return { locale: deps.hl ?? DEFAULT_LOCALE };
  },
  head: ({ loaderData, params }) =>
    animeHead(loaderData?.locale ?? DEFAULT_LOCALE, params.bangumiId, siteOrigin()),
  component: AnimeRoute,
});

function AnimeRoute() {
  const { bangumiId } = Route.useParams();
  const { locale } = Route.useLoaderData();
  const { data } = useAnimeOverview(bangumiId);
  return <AnimePage overview={data} locale={locale} />;
}
