import type { ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import globalsUrl from "../styles/globals.css?url";

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

export const Route = createRootRoute({
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
