import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { THEME_BOOTSTRAP_SCRIPT } from "../components/theme-bootstrap";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../i18n/locales";
import globalsUrl from "../styles/globals.css?url";

interface RouterContext {
  readonly queryClient: QueryClient;
}

type RootDocumentProps = Readonly<{
  children: ReactNode;
}>;

const rootHead = {
  links: [{ rel: "stylesheet", href: globalsUrl }],
  // Pre-hydration theme init: every route honors the stored preference,
  // and the landing page cannot flash the day default.
  scripts: [{ children: THEME_BOOTSTRAP_SCRIPT }],
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: "Animichi" },
    { name: "description", content: "Anime pilgrimage routes in minutes." },
  ],
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => rootHead,
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

interface LocaleBearingMatch {
  readonly loaderData?: unknown;
}

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function localeOf(data: unknown): Locale | null {
  if (typeof data !== "object" || data === null || !("locale" in data)) return null;
  return isLocale(data.locale) ? data.locale : null;
}

/** SSR lang source: deepest locale-bearing match wins, else DEFAULT_LOCALE. */
export function langFromMatches(matches: readonly LocaleBearingMatch[]): Locale {
  for (const match of [...matches].reverse()) {
    const locale = localeOf(match.loaderData);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

function RootDocument({ children }: RootDocumentProps) {
  const lang = langFromMatches(useMatches());
  return (
    <html lang={lang}>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
