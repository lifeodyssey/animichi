import { ORPCError } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { AnimeOverview } from "@animichi/contract";
import { resolveOrigin } from "../../api/config";
import { animeOverviewOptions, useAnimeOverview } from "../../api/hooks/use-anime-overview";
import { AnimePage } from "../../features/anime/AnimePage";
import { animeHead } from "../../features/anime/head";
import { buildAnimeJsonLd } from "../../features/anime/structured-data";
import { useRegisterAnimeSw } from "../../features/anime/register-sw";
import { AnimeErrorState, AnimePendingState } from "../../features/anime/route-states";
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

/**
 * Only the catalog's typed WORK_NOT_FOUND becomes a router 404. Any other
 * 404 (a gateway HTML page when the backend is down, a routing mishap) is an
 * outage and must reach the errorComponent, never a soft-404.
 */
function isWorkNotFound(error: unknown): boolean {
  return error instanceof ORPCError && error.defined && error.code === "WORK_NOT_FOUND";
}

async function loadOverview(queryClient: QueryClient, bangumiId: string): Promise<AnimeOverview> {
  try {
    return await queryClient.ensureQueryData(animeOverviewOptions(bangumiId));
  } catch (error) {
    if (isWorkNotFound(error)) throw notFoundError();
    throw error;
  }
}

export const Route = createFileRoute("/anime/$bangumiId")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ hl: search.hl }),
  loader: async ({ params, deps, context }) => {
    if (!BANGUMI_ID_PATTERN.test(params.bangumiId)) throw notFoundError();
    const overview = await loadOverview(context.queryClient, params.bangumiId);
    const locale = deps.hl ?? DEFAULT_LOCALE;
    return {
      locale,
      indexable: overview.points_length > 0,
      jsonLd: buildAnimeJsonLd(overview, locale, siteOrigin()),
    };
  },
  head: ({ loaderData, params }) =>
    animeHead(loaderData?.locale ?? DEFAULT_LOCALE, params.bangumiId, siteOrigin(), {
      indexable: loaderData?.indexable ?? true,
      jsonLd: loaderData?.jsonLd ?? [],
    }),
  errorComponent: AnimeErrorState,
  pendingComponent: AnimePendingState,
  component: AnimeRoute,
});

function AnimeRoute() {
  useRegisterAnimeSw();
  const { bangumiId } = Route.useParams();
  const { locale } = Route.useLoaderData();
  const { data } = useAnimeOverview(bangumiId);
  return <AnimePage overview={data} locale={locale} />;
}
