"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDict } from "../../lib/i18n-context";
import { safeRedirect } from "../../lib/safe-redirect";
import LoginForm from "../../components/auth/LoginForm";

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
  const initialError = urlError === "expired" ? t.link_expired_error : null;

  return (
    <main className="bg-gradient-soft flex min-h-[100svh] flex-col items-center justify-center px-4">
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
          <LoginForm redirect={redirect} initialError={initialError} />
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-muted-foreground underline hover:text-foreground">
            ← {t.back_to_home}
          </Link>
        </div>
      </div>
    </main>
  );
}
