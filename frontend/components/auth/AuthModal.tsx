"use client";

import { useDict } from "../../lib/i18n-context";

interface AuthModalProps {
  email: string;
  submitting: boolean;
  sent: boolean;
  effectiveStatus: string | null;
  authConfigured: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onClose: () => void;
}

export default function AuthModal({
  email,
  submitting,
  sent,
  effectiveStatus,
  authConfigured,
  onEmailChange,
  onSubmit,
  onBack,
  onClose,
}: AuthModalProps) {
  const t = useDict().auth;

  return (
    <div
      data-testid="auth-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-labelledby="auth-modal-title"
        className="entrance-up-quick relative mx-4 w-full max-w-[420px] rounded-xl bg-background p-8 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="mb-8">
          <h2 id="auth-modal-title" className="text-base font-medium text-foreground">
            {t.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.subtitle}
          </p>
        </div>

        {sent ? (
          <SentConfirmation onBack={onBack} t={t} />
        ) : (
          <LoginFormInline
            email={email}
            submitting={submitting}
            authConfigured={authConfigured}
            effectiveStatus={effectiveStatus}
            onEmailChange={onEmailChange}
            onSubmit={onSubmit}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function SentConfirmation({ onBack, t }: { onBack: () => void; t: ReturnType<typeof useDict>["auth"] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
      <p className="text-sm font-medium text-foreground">{t.check_email_heading}</p>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">{t.check_email_body}</p>
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] text-xs underline text-muted-foreground"
      >
        {t.back_to_login}
      </button>
    </div>
  );
}

function LoginFormInline({
  email, submitting, authConfigured, effectiveStatus, onEmailChange, onSubmit, t,
}: {
  email: string; submitting: boolean; authConfigured: boolean;
  effectiveStatus: string | null; onEmailChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void; t: ReturnType<typeof useDict>["auth"];
}) {
  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-email" className="text-xs font-medium text-muted-foreground">
            {t.email_label}
          </label>
          <input
            id="auth-email"
            type="email"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={t.email_placeholder}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !authConfigured}
          className="relative min-h-[44px] w-full rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-fg transition duration-150 hover:opacity-90 disabled:opacity-40"
        >
          {submitting && (
            <span className="absolute left-1/2 top-1/2 -translate-x-[calc(50%+3em)] -translate-y-1/2">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-fg border-t-transparent" />
            </span>
          )}
          {submitting ? t.submitting : t.btn_login}
        </button>
      </form>

      {effectiveStatus && (
        <p role="alert" className="mt-5 text-xs font-medium leading-relaxed text-[oklch(50%_0.15_25)]">
          {effectiveStatus}
        </p>
      )}
    </>
  );
}
