import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

const testRoot = createRootRoute();

/** The app's link destinations, without their components: `<Link>` only needs
 * the router to resolve `to`/`params`/`search` into an href. */
const testTree = testRoot.addChildren([
  createRoute({ getParentRoute: () => testRoot, path: "/" }),
  createRoute({ getParentRoute: () => testRoot, path: "/chat" }),
  createRoute({ getParentRoute: () => testRoot, path: "/settings" }),
  createRoute({ getParentRoute: () => testRoot, path: "/privacy" }),
  createRoute({ getParentRoute: () => testRoot, path: "/anime/$bangumiId" }),
]);

export function makeAppRouter(at = "/") {
  return createRouter({ routeTree: testTree, history: createMemoryHistory({ initialEntries: [at] }) });
}

/** Router context for components that render `<Link>` (issue #1337). */
export function AppRouterContext({ children }: Readonly<{ children: ReactNode }>) {
  const [router] = useState(makeAppRouter);
  return <RouterContextProvider router={router}>{children}</RouterContextProvider>;
}
