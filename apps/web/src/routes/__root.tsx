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
import { Splash } from "../components/Splash";
import { THEME_BOOTSTRAP_SCRIPT } from "../components/theme-bootstrap";
import { cfWebAnalyticsScripts } from "../features/seo/analytics";
import { useFieldVitals } from "../features/telemetry/lib/use-field-vitals";
import { SITE_ICON_LINKS, SITE_META } from "../features/seo/head";
import { SITE_DESCRIPTION, SITE_TITLE } from "../features/seo/site";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../i18n/locales";
import globalsUrl from "../styles/globals.css?url";

// Landing first-screen key-weight faces (C8): with font-display: swap, a
// late webfont arrival reflows the page (CLS). Preloading the four faces
// actually referenced on the mobile first screen — Zen Maru Gothic 700
// (wordmark/bubble/CTA), Noto Serif JP 700 (title), Zen Maru Gothic 500
// (lead), Nunito 700 ("EN" chip) — pulls them into the font cache during
// HTML parse, so first paint can use the webfont metrics directly. Bounded
// at four: more preloads just crowd the bandwidth budget while the
// metric-aligned fallbacks in fonts.css absorb any remaining swaps.
const FONT_PRELOADS = [
  { rel: "preload", href: "/fonts/zen-maru-gothic-japanese-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/noto-serif-jp-japanese-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/zen-maru-gothic-japanese-500-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/nunito-latin-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
] as const;

interface RouterContext {
  readonly queryClient: QueryClient;
}

type RootDocumentProps = Readonly<{
  children: ReactNode;
}>;

export const rootHead = {
  links: [
    { rel: "stylesheet", href: globalsUrl },
    ...FONT_PRELOADS,
    ...SITE_ICON_LINKS,
  ],
  // Pre-hydration theme init: every route honors the stored preference,
  // and the landing page cannot flash the day default. The Cloudflare Web
  // Analytics beacon joins the head only in production builds with an
  // injected token (see features/seo/analytics.ts).
  scripts: [
    { children: THEME_BOOTSTRAP_SCRIPT },
    ...cfWebAnalyticsScripts(import.meta.env.VITE_CF_BEACON_TOKEN, import.meta.env.PROD),
  ],
  // Social-card defaults live at the root so every route has a card; deeper
  // routes override `title` only, which is why og:title stays the site title.
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: SITE_TITLE },
    { name: "description", content: SITE_DESCRIPTION },
    ...SITE_META,
  ],
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => rootHead,
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
});

function RootComponent() {
  useFieldVitals();
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

/** WCAG 2.4.1 Bypass Blocks: a keyboard-reachable "skip to content" link as
 * the page's first tab stop. It is visually hidden until it receives focus,
 * then jumps the user's focus into the route's main content region. */
export function skipLabel(lang: Locale): string {
  return lang === "ja" ? "コンテンツへ移動" : lang === "zh" ? "跳转到主要内容" : "Skip to content";
}

export function SkipLink({ lang }: { readonly lang: Locale }) {
  return (
    <a className="skip-link" href="#main-content">{skipLabel(lang)}</a>
  );
}

function RootDocument({ children }: RootDocumentProps) {
  const lang = langFromMatches(useMatches());
  return (
    <html lang={lang}>
      <head><HeadContent /></head>
      <body><Splash /><SkipLink lang={lang} /><div id="main-content" tabIndex={-1}>{children}</div><Scripts /></body>
    </html>
  );
}
