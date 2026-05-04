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
        emailRedirectTo: `${window.location.origin}/auth/confirm?redirect=${encodeURIComponent(redirect)}`,
        data: { locale: detectLocale() },
      },
    });
    if (authError) { setError(t.error.replace("{message}", authError.message)); } else { setSent(true); }
    setSubmitting(false);
  }, [email, redirect, supabase, t]);

  if (sent) {
    return (
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
          className="w-full border-b border-border bg-transparent py-2 text-sm text-foreground placeholder:text-border focus:border-primary focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !supabase}
        className="min-h-[44px] w-full rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-fg transition duration-150 hover:opacity-90 disabled:opacity-40"
      >
        {submitting ? t.submitting : t.btn_login}
      </button>
      {error && (
        <p className="text-xs font-light leading-relaxed text-muted-foreground">{error}</p>
      )}
    </form>
  );
}
