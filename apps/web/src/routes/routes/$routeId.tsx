import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  listRoutesOptions,
  selectRouteDetail,
  useSavedRoutes,
} from "../../api/hooks/use-route-detail";
import { RouteDetailView } from "../../components/route-detail/RouteDetailView";
import { RouteDetailErrorState, RouteDetailPendingState } from "../../components/route-detail/route-states";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../../i18n/locales";

/** A real `Error` carrying TanStack's not-found marker (`isNotFound: true`). */
function notFoundError(): Error {
  return Object.assign(new Error("unknown route id"), notFound());
}

function parseSearch(search: Record<string, unknown>): { readonly hl?: Locale } {
  const hl = search.hl;
  if (typeof hl === "string" && (LOCALES as readonly string[]).includes(hl)) return { hl: hl as Locale };
  return {};
}

async function assertRouteExists(queryClient: QueryClient, routeId: string): Promise<void> {
  const { routes } = await queryClient.ensureQueryData(listRoutesOptions());
  if (!routes.some((route) => route.id === routeId)) throw notFoundError();
}

export const Route = createFileRoute("/routes/$routeId")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ hl: search.hl }),
  loader: async ({ params, deps, context }) => {
    await assertRouteExists(context.queryClient, params.routeId);
    return { locale: deps.hl ?? DEFAULT_LOCALE };
  },
  errorComponent: RouteDetailErrorState,
  pendingComponent: RouteDetailPendingState,
  component: RouteDetailRoute,
});

function RouteDetailRoute() {
  const { locale } = Route.useLoaderData();
  const { routeId } = Route.useParams();
  const { data } = useSavedRoutes();
  const detail = selectRouteDetail(data.routes, routeId);
  return <RouteDetailView detail={detail} locale={locale} now={new Date()} />;
}
