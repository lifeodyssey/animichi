import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../i18n/locales";
import { animeCopyFor, type AnimeCopy } from "./copy";

/**
 * Branded error + pending states for `/anime/:id` (NotFound style). The
 * caught error is intentionally never rendered: technical text (env vars,
 * upstream messages, stack traces) must not reach the user.
 *
 * Retry follows the official Router x Query integration: reset the query
 * error boundary on mount, then `router.invalidate()` reruns the loader.
 */
function useRetry(): () => void {
  const router = useRouter();
  const boundary = useQueryErrorResetBoundary();
  useEffect(() => {
    boundary.reset();
  }, [boundary]);
  return () => void router.invalidate();
}

/** The loader failed, so no loaderData: the `hl` search param is the source. */
function useErrorLocale(): Locale {
  const search: Readonly<Record<string, unknown>> = useSearch({ strict: false });
  const hl = search.hl;
  return typeof hl === "string" && isLocale(hl) ? hl : DEFAULT_LOCALE;
}

type ErrorCopyProps = Readonly<{ copy: AnimeCopy }>;

function AnimeErrorActions({ copy, onRetry }: ErrorCopyProps & Readonly<{ onRetry: () => void }>) {
  return (
    <p className="m-0 flex items-center justify-center gap-4">
      <button type="button" className="home-link" onClick={onRetry}>{copy.errorRetry}</button>
      <a className="home-link" href="/">{copy.errorHome}</a>
    </p>
  );
}

function AnimeErrorHeading({ copy }: ErrorCopyProps) {
  return (
    <>
      <p className="eyebrow">Animichi</p>
      <h1 id="anime-error-title">{copy.errorTitle}</h1>
      <p className="tagline">{copy.errorBody}</p>
    </>
  );
}

export function AnimeErrorState() {
  const handleRetry = useRetry();
  const copy = animeCopyFor(useErrorLocale());
  return (
    <main className="app-shell hero compact" aria-labelledby="anime-error-title">
      <AnimeErrorHeading copy={copy} />
      <AnimeErrorActions copy={copy} onRetry={handleRetry} />
    </main>
  );
}

export function AnimePendingState() {
  return (
    <main role="status" aria-label="Loading" className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <div className="h-24 animate-pulse rounded-2xl bg-[var(--color-card)]" />
      <div className="h-40 animate-pulse rounded-2xl bg-[var(--color-card)]" />
      <div className="h-64 animate-pulse rounded-2xl bg-[var(--color-card)]" />
    </main>
  );
}
