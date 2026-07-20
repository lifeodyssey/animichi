import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { AuthCallback } from "../../components/auth/AuthCallback";
import { returnTargetNamesSession } from "../../features/chat/return-target";
import { LocaleProvider } from "../../i18n/context";
import { carriesPanelIntent, sanitizeReturnTarget } from "../../lib/auth/returnTarget";

/**
 * `next` rides the magic-link callback URL because the link may open in a
 * fresh tab (#284 Task 8): the callback URL is the only carrier the BYOK
 * setup intent survives in. It is caller-influenceable, so it passes the T14
 * open-redirect guard twice — once at search parse, once again at navigate —
 * and anything that is not a same-origin relative path collapses to `/`,
 * which is exactly today's behaviour for a link with no `next` at all.
 */
interface CallbackSearch {
  readonly next?: string;
}

function parseCallbackSearch(input: Record<string, unknown>): CallbackSearch {
  const next = sanitizeReturnTarget(input.next);
  return next === "/" ? {} : { next };
}

export const Route = createFileRoute("/auth/callback")({
  validateSearch: parseCallbackSearch,
  component: AuthCallbackRoute,
});

function useGoToTarget(next: string | undefined): () => void {
  const navigate = useNavigate();
  const target = sanitizeReturnTarget(next);
  return useCallback(() => {
    void navigate({ href: target });
  }, [navigate, target]);
}

function AuthCallbackRoute() {
  const { next } = Route.useSearch();
  const props = { hasReturnIntent: carriesPanelIntent(next), expectsMigration: returnTargetNamesSession(next) };
  return (
    <LocaleProvider>
      <AuthCallback onDone={useGoToTarget(next)} {...props} />
    </LocaleProvider>
  );
}
