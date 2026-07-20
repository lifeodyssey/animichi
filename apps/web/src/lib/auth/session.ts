import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/client";

/** Root-route auth gate state; `pending` renders the anonymous Landing (S5.5). */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

function authBaseUrl(): string | undefined {
  const value = import.meta.env.VITE_NEON_AUTH_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Resolve the caller's auth status; unconfigured or failing auth is anonymous. */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const base = authBaseUrl();
  if (!base) return "anonymous";
  try {
    const { data } = await createAuthClient({ baseURL: base }).getSession();
    return data ? "authenticated" : "anonymous";
  } catch {
    return "anonymous";
  }
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
