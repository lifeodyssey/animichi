import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { AuthCallback } from "../../components/auth/AuthCallback";
import { LocaleProvider } from "../../i18n/context";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackRoute,
});

function useGoHome(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);
}

function AuthCallbackRoute() {
  return (
    <LocaleProvider>
      <AuthCallback onDone={useGoHome()} />
    </LocaleProvider>
  );
}
