import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHome } from "../components/home/AppHome";
import { makeSearchHandler } from "../components/home/search-target";
import { LandingPage } from "../components/landing/LandingPage";
import { LocaleProvider } from "../i18n/context";
import { useAuthStatus } from "../lib/auth/session";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function AuthedHome() {
  const navigate = useNavigate();
  return <AppHome onSearch={makeSearchHandler((target) => { void navigate(target); })} />;
}

/** Single root route, dual state: App Home for authenticated users (spec S5.5),
 * the S0.6 marketing Landing for everyone else (pending resolves to Landing). */
export function HomeView() {
  return useAuthStatus() === "authenticated" ? <AuthedHome /> : <LandingPage />;
}

export function HomeRoute() {
  return (
    <LocaleProvider>
      <HomeView />
    </LocaleProvider>
  );
}
