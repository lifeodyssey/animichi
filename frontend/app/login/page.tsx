"use client";

import { useSearchParams } from "next/navigation";
import { useDict } from "../../lib/i18n-context";
import { safeRedirect } from "../../lib/safe-redirect";
import SharedHeader from "../../components/layout/SharedHeader";
import LoginForm from "../../components/auth/LoginForm";

export default function LoginPage() {
  const t = useDict().auth;
  const searchParams = useSearchParams();
  const redirect = safeRedirect(searchParams.get("redirect"), "/");
  const urlError = searchParams.get("error");
  const initialError = urlError === "expired" ? t.link_expired_error : null;

  return (
    <div className="bg-gradient-soft flex min-h-[100svh] flex-col">
      <SharedHeader loginHref={undefined} />

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="entrance-up w-full max-w-[380px]">
          <div className="mb-6 text-center">
            <p className="text-lg font-medium text-foreground">{t.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.login_page_subtitle}</p>
          </div>

          <div className="rounded-xl bg-card p-8 shadow-md">
            <LoginForm redirect={redirect} initialError={initialError} />
          </div>
        </div>
      </main>
    </div>
  );
}
