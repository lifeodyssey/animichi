import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import globalsUrl from "../styles/globals.css?url";

interface RouterContext {
  readonly queryClient: QueryClient;
}

type RootDocumentProps = Readonly<{
  children: ReactNode;
}>;

const rootHead = {
  links: [{ rel: "stylesheet", href: globalsUrl }],
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

function RootDocument({ children }: RootDocumentProps) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
