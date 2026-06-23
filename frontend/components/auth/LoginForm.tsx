"use client";

import { useCallback, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useDict } from "../../lib/i18n-context";
import { detectLocale } from "../../lib/i18n";

interface LoginFormProps {
  redirect: string;
  initialError?: string | null;
}

export default function LoginForm({ redirect, initialError }: LoginFormProps) {
  const t = useDict().auth;
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const handleSubmit = useCallback(async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase) { setError(t.not_configured); return; }
    setSubmitting(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        data: { locale: detectLocale() },
      },
    });
    if (authError) { setError(t.error.replace("{message}", authError.message)); } else { setSent(true); }
    setSubmitting(false);
  }, [email, redirect, supabase, t]);

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-5 py-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-base font-semibold text-foreground">{t.check_email_heading}</p>
          <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">{t.check_email_body}</p>
        </div>
        <button
          type="button"
          onClick={() => { setSent(false); setError(null); }}
          className="text-sm text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
        >
          {t.back_to_login}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold text-foreground">{t.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t.subtitle}</p>
      </div>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground">
            {t.email_label}
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); }}
            placeholder={t.email_placeholder}
            className="w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 shadow-3d-sm transition-all duration-150 ease-[var(--ease-animal)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground/70">{t.magic_link_hint}</p>
        <button
          type="submit"
          disabled={submitting || !supabase}
          className="relative min-h-[44px] w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-fg shadow-3d-lg transition-all duration-150 ease-[var(--ease-animal)] hover:-translate-y-px hover:opacity-90 active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:shadow-none"
        >
          {submitting && (
            <span className="absolute left-1/2 top-1/2 -translate-x-[calc(50%+3em)] -translate-y-1/2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-fg border-t-transparent" />
            </span>
          )}
          {submitting ? t.submitting : t.btn_login}
        </button>
        {error && (
          <p role="alert" className="text-xs font-medium leading-relaxed text-error-fg">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
