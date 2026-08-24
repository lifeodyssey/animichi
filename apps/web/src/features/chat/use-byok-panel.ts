import { useRouter } from "@tanstack/react-router";
import type { AuthStatus } from "../../lib/auth/session";
import type { ChatSearch } from "./search";

/**
 * Open/closed state for the BYOK settings drawer launched from the app bar
 * (issue #284 Task 6 entry point). `?settings=byok` opens it on arrival —
 * that is the deep-link the whole Task 8 journey returns through, so a magic
 * link opened in a fresh tab still lands on the open panel.
 *
 * Issue #1009 AC4: the URL owns the open state. `open` derives from
 * `search.settings` — it is never copied into local state — and `toggle` /
 * `show` write the URL, so the route's `useSearch` re-render is what opens
 * or closes the panel.
 */
export interface ByokPanel {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly hide: () => void;
  /** Open without toggling — D14's "open key settings" action (#480 P2-1). */
  readonly show: () => void;
  readonly auth: AuthStatus;
}

function writeByokSettings(
  router: ReturnType<typeof useRouter>,
  search: ChatSearch,
  settings: "byok" | undefined,
): Promise<unknown> {
  return router.navigate({
    to: "/chat",
    search: { q: search.q, session: search.session, route: search.route, settings },
  });
}

export function useByokPanel(search: ChatSearch, auth: AuthStatus): ByokPanel {
  const router = useRouter();
  const open = search.settings === "byok";
  const toggle = (): void => { void writeByokSettings(router, search, open ? undefined : "byok"); };
  const show = (): void => { void writeByokSettings(router, search, "byok"); };
  const hide = (): void => { void writeByokSettings(router, search, undefined); };
  return { open, toggle, hide, show, auth };
}
