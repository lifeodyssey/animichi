"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/browser";
import { useDict } from "../../lib/i18n-context";
import { detectLocale } from "../../lib/i18n";
import { safeRedirect } from "../../lib/safe-redirect";

const ToriiIcon = () => (
  <svg viewBox="0 0 72 72" width="40" height="40" fill="none" aria-hidden="true">
    <rect x="12" y="16" width="48" height="5" rx="2.5" fill="var(--color-torii)" />
    <rect x="8" y="14" width="56" height="3" rx="1.5" fill="var(--color-torii)" />
    <rect x="16" y="21" width="5" height="35" rx="1" fill="var(--color-torii)" />
    <rect x="51" y="21" width="5" height="35" rx="1" fill="var(--color-torii)" />
    <rect x="12" y="30" width="48" height="3" rx="1.5" fill="var(--color-torii)" opacity=".5" />
  </svg>
);

export default function LoginPage() {
  const t = useDict().auth;
  const searchParams = useSearchParams();
  const redirect = safeRedirect(searchParams.get("redirect"), "/");
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError === "expired" ? t.link_expired_error : null,
  );

  const supabase = createClient();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError(t.not_configured); return; }
    setSubmitting(true);
    setError(null);
    const detectedLocale = detectLocale();
    const normalizedEmail = email.trim().toLowerCase();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?redirect=${encodeURIComponent(redirect)}`,
        data: { locale: detectedLocale },
      },
    });
    if (authError) { setError(t.error.replace("{message}", authError.message)); } else { setSent(true); }
    setSubmitting(false);
  }, [email, redirect, supabase, t]);

  return (
    <main
      className="flex min-h-[100svh] flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, var(--color-gradient-soft), var(--color-bg))" }}
    >
      <div className="entrance-up w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <ToriiIcon />
          <h1 className="font-display text-2xl font-bold tracking-[0.02em] text-foreground">
            聖地巡礼
          </h1>
          <span className="text-xs tracking-[1.5px] text-muted-foreground">seichijunrei</span>
        </div>

        <div className="mb-6 text-center">
          <p className="text-base font-medium text-foreground">{t.title}</p>
          <p className="mt-1 text-sm font-light text-muted-foreground">{t.login_page_subtitle}</p>
        </div>

        <div className="rounded-xl bg-card p-8 shadow-md">
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-foreground">{t.check_email_heading}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{t.check_email_body}</p>
              <button
                type="button"
                onClick={() => { setSent(false); setError(null); }}
                className="min-h-[44px] text-xs underline text-muted-foreground"
              >
                {t.back_to_login}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground">
                  {t.email_label}
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.email_placeholder}
                  className="w-full border-b border-border bg-transparent py-2 text-sm text-foreground placeholder:text-border focus:border-primary focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !supabase}
                className="min-h-[44px] w-full rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-fg transition hover:opacity-90 disabled:opacity-40"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {submitting ? t.submitting : t.btn_login}
              </button>

              {error && (
                <p className="text-xs font-light leading-relaxed text-muted-foreground">{error}</p>
              )}
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-muted-foreground underline hover:text-foreground">
            ← {t.back_to_login}
          </Link>
        </div>
      </div>
    </main>
  );
}
