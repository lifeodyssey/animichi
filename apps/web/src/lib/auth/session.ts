import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/client";

/** Root-route auth gate state; `pending` renders the anonymous Landing (S5.5). */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

function authBaseUrl(): string | undefined {
  const value = import.meta.env.VITE_NEON_AUTH_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function resolveAuthStatus(): Promise<AuthStatus> {
  const base = authBaseUrl();
  if (!base) return "anonymous";
  try {
    const { data } = await createAuthClient({ baseURL: base }).getSession();
    return data ? "authenticated" : "anonymous";
  } catch {
    return "anonymous";
  }
}

/** In-flight only: several route cards mounting together must share one
 * `getSession` round trip, but nothing is cached past settlement, so a login
 * is never masked by a stale value. */
let inFlight: Promise<AuthStatus> | undefined;

/** Resolve the caller's auth status; unconfigured or failing auth is anonymous. */
export function fetchAuthStatus(): Promise<AuthStatus> {
  inFlight ??= resolveAuthStatus().finally(() => { inFlight = undefined; });
  return inFlight;
}

export function useAuthStatus(fetcher: () => Promise<AuthStatus> = fetchAuthStatus): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>("pending");
  useEffect(() => {
    let active = true;
    void fetcher().then((next) => { if (active) setStatus(next); });
    return () => { active = false; };
  }, [fetcher]);
  return status;
}
