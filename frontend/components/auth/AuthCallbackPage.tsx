"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useDict } from "../../lib/i18n-context";
import { createClient } from "../../lib/supabase/browser";

export function AuthCallbackPage() {
  const t = useDict().auth;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      try {
        const supabase = createClient();
        if (!supabase) throw new Error(t.not_configured);

        // Implicit flow: Supabase auto-extracts access_token from the URL hash
        // on client init, so getSession() already returns the session.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (!cancelled) window.location.replace("/chat");
          return;
        }

        // Fallback: PKCE code or OTP token_hash in query params
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (error) throw error;
        } else {
          throw new Error(t.callback_error);
        }

        if (!cancelled) window.location.replace("/chat");
      } catch (authError) {
        if (cancelled) return;
        const message = authError instanceof Error ? authError.message : t.callback_error;
        setError(message);
      }
    }

    completeAuth();
    return () => { cancelled = true; };
  }, [t]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          聖地巡礼
        </h1>
        <p className="mt-6 text-sm text-muted-foreground">
          {t.link_expired}
        </p>
        <Link
          href="/"
          className="mt-4 text-sm text-primary hover:underline"
        >
          {t.request_new_link}
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <h1 className="font-display text-3xl font-semibold text-foreground">
        聖地巡礼
      </h1>
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className="spin-loading inline-block h-4 w-4 rounded-full border-2 border-primary border-t-transparent"
        />
        <span>{t.verifying}</span>
      </div>
    </main>
  );
}
