import { useEffect, useState } from "react";
import { getAuthToken } from "./auth-session";

/** Root-route auth gate state; `pending` renders the anonymous Landing (S5.5). */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

async function resolveAuthStatus(): Promise<AuthStatus> {
  return (await getAuthToken()) ? "authenticated" : "anonymous";
}

/** In-flight only: several route cards mounting together must share one
 * JWT lookup, but nothing is cached past settlement, so a login is never
 * masked by a stale value. The JWT itself is the same one API headers use. */
let inFlight: Promise<AuthStatus> | undefined;

/** Resolve the caller's auth status; unconfigured or failing auth is anonymous. */
export function fetchAuthStatus(): Promise<AuthStatus> {
  inFlight ??= resolveAuthStatus().finally(() => { inFlight = undefined; });
  return inFlight;
}

export function useAuthStatus(fetcher: () => Promise<AuthStatus> = fetchAuthStatus): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>("pending");
  useEffect(() => {
    let isActive = true;
    void fetcher().then((next) => { if (isActive) setStatus(next); });
    return () => { isActive = false; };
  }, [fetcher]);
  return status;
}
