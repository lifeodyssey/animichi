import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/client";
import { currentRuntimeConfig } from "../runtime-config/provider";

/** Root-route auth gate state; `pending` renders the anonymous Landing (S5.5). */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

function authBaseUrl(): string | undefined {
  return currentRuntimeConfig().neonAuthBaseUrl;
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
    let isActive = true;
    void fetcher().then((next) => { if (isActive) setStatus(next); });
    return () => { isActive = false; };
  }, [fetcher]);
  return status;
}
