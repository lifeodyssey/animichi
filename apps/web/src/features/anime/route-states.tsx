import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

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

function AnimeErrorActions({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <p className="m-0 flex items-center justify-center gap-4">
      <button type="button" className="home-link" onClick={onRetry}>Try again</button>
      <a className="home-link" href="/">Return home</a>
    </p>
  );
}

function AnimeErrorHeading() {
  return (
    <>
      <p className="eyebrow">Animichi</p>
      <h1 id="anime-error-title">Something went wrong</h1>
      <p className="tagline">We could not load this title right now. Please try again.</p>
    </>
  );
}

export function AnimeErrorState() {
  const handleRetry = useRetry();
  return (
    <main className="app-shell hero compact" aria-labelledby="anime-error-title">
      <AnimeErrorHeading />
      <AnimeErrorActions onRetry={handleRetry} />
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
