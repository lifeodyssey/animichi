"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Backward-compat redirect: old magic links pointed to /auth/callback.
 * Forward all query params to /auth/confirm (the new Route Handler).
 */
export default function AuthCallbackRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    router.replace(`/auth/confirm?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Redirecting…</div>
    </main>
  );
}
