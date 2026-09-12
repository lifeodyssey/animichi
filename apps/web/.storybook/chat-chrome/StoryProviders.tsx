import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChatActionsProvider } from "../../src/features/chat/ChatActions";
import { ChatReturnTargetProvider } from "../../src/features/chat/ChatReturnTarget";
import { LocaleProvider, useSetLocale } from "../../src/i18n/LocaleProvider";
import { isLocale } from "../../src/i18n/locales";
import type { Locale } from "../../src/i18n/locales";

const root = createRootRoute();
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/" }),
  createRoute({ getParentRoute: () => root, path: "/chat" }),
  createRoute({ getParentRoute: () => root, path: "/settings" }),
  createRoute({ getParentRoute: () => root, path: "/privacy" }),
  createRoute({ getParentRoute: () => root, path: "/anime/$bangumiId" }),
]);

function storyRouter() {
  const history = createMemoryHistory({ initialEntries: ["/chat?session=storybook"] });
  return createRouter({ routeTree, history });
}

function storyQueryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["chat", "conversations", "/storybook"], [
    { id: "kyoto", title: "響け！ユーフォニアム", subtitle: "宇治を一日で歩きたい" },
    { id: "kamakura", title: "鎌倉の海辺", subtitle: "スラムダンクの踏切へ" },
  ]);
  return client;
}

function localeOf(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : "ja";
}

function LocaleSync({ locale }: Readonly<{ locale: Locale }>) {
  const setLocale = useSetLocale();
  useEffect(() => { setLocale(locale); }, [locale, setLocale]);
  return null;
}

export function StoryProviders({ locale, children }: Readonly<{ locale: unknown; children: ReactNode }>) {
  const [router] = useState(storyRouter);
  const [queryClient] = useState(storyQueryClient);
  const actions = { send: () => undefined, regenerate: () => undefined };
  const content = <LocaleProvider><LocaleSync locale={localeOf(locale)} />{children}</LocaleProvider>;
  const providers = <QueryClientProvider client={queryClient}><ChatReturnTargetProvider sessionIdOf={() => "storybook"}><ChatActionsProvider actions={actions}>{content}</ChatActionsProvider></ChatReturnTargetProvider></QueryClientProvider>;
  return <RouterContextProvider router={router}>{providers}</RouterContextProvider>;
}
