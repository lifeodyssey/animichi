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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
      <div className="flex flex-col items-center gap-4 py-2">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
        <p className="text-sm font-medium text-foreground">{t.check_email_heading}</p>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">{t.check_email_body}</p>
        <button
          type="button"
          onClick={() => { setSent(false); setError(null); }}
          className="min-h-[44px] text-xs underline text-muted-foreground"
        >
          {t.back_to_login}
        </button>
      </div>
    );
  }

  return (
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
          className="w-full rounded-md border border-border bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t.magic_link_hint}</p>
      <button
        type="submit"
        disabled={submitting || !supabase}
        className="relative min-h-[44px] w-full rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-fg transition duration-150 hover:opacity-90 disabled:opacity-40"
      >
        {submitting && (
          <span className="absolute left-1/2 top-1/2 -translate-x-[calc(50%+3em)] -translate-y-1/2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-fg border-t-transparent" />
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
  );
}
