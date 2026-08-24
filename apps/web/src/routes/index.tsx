import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHome } from "../components/home/AppHome";
import { makeSearchHandler } from "../components/home/search-target";
import { DoorwaySummary } from "../features/seo/DoorwaySummary";
import { homeHead } from "../features/seo/head";
import { useChatHandoff } from "../features/splash/chat-handoff";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { useAuthStatus } from "../lib/auth/session";

export const Route = createFileRoute("/")({
  head: homeHead,
  component: HomeRoute,
});

function AuthedHome() {
  const navigate = useNavigate();
  return <AppHome onSearch={makeSearchHandler((target) => { void navigate(target); })} />;
}

/** Mobile hands `/` off to chat as soon as the client takes over. `replace` is
 * required — a pushed entry would send Back to `/`, which would bounce the
 * visitor straight into chat again. Desktop waits for the doorway CTA. */
function useChatEntry(): () => void {
  const navigate = useNavigate();
  return useCallback(() => { void navigate({ to: "/chat", replace: true }); }, [navigate]);
}

/** Single root route, dual state: App Home for authenticated users (spec S5.5),
 * the indexable doorway summary for everyone else — which is also what the SSR
 * pass renders, because auth resolves as `pending` on the server. */
export function HomeView() {
  useChatHandoff(useChatEntry());
  return useAuthStatus() === "authenticated" ? <AuthedHome /> : <DoorwaySummary />;
}

export function HomeRoute() {
  return (
    <LocaleProvider>
      <HomeView />
    </LocaleProvider>
  );
}
