"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../lib/supabase/browser";
import { useDict } from "../lib/i18n-context";
import { detectLocale } from "../lib/i18n";
import LandingPage from "../components/auth/LandingPage";
import AuthModal from "../components/auth/AuthModal";

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useDict().auth;
  const authClient = createClient();
  const authConfigured = !!authClient;

  const redirect = searchParams.get("redirect") ?? "/chat";
  const [showAuthModal, setShowAuthModal] = useState(
    searchParams.get("login") === "true",
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // If already logged in and ?login=true, go to redirect target
  useEffect(() => {
    if (!authClient) return;
    authClient.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(redirect);
    });
  }, [authClient, router, redirect]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) { setStatus(t.not_configured); return; }
    setSubmitting(true);
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();
    const locale = detectLocale();
    const { error } = await authClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?redirect=${encodeURIComponent(redirect)}`,
        data: { locale },
      },
    });
    if (error) {
      setStatus(t.error.replace("{message}", error.message));
    } else {
      setSent(true);
    }
    setSubmitting(false);
  }

  return (
    <>
      <LandingPage onOpenAuth={() => setShowAuthModal(true)} />
      {showAuthModal && (
        <AuthModal
          email={email}
          submitting={submitting}
          sent={sent}
          effectiveStatus={status ?? (!authConfigured ? t.not_configured : null)}
          authConfigured={authConfigured}
          onEmailChange={setEmail}
          onSubmit={handleLogin}
          onBack={() => { setSent(false); setStatus(null); }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
}
