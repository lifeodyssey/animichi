"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../lib/supabase/browser";
import { safeRedirect } from "../lib/safe-redirect";
import LandingPage from "../components/landing/LandingPage";
import LoginModal from "../components/auth/LoginModal";

export default function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authClient = createClient();

  const redirect = safeRedirect(searchParams.get("redirect"));
  const [showLoginModal, setShowLoginModal] = useState(
    searchParams.get("login") === "true",
  );
  const [pendingRedirect, setPendingRedirect] = useState(redirect);

  // Only auto-redirect when an explicit ?redirect= param is present
  // (e.g. from a protected page). Otherwise logged-in users stay on landing.
  useEffect(() => {
    if (!authClient || !searchParams.get("redirect")) return;
    authClient.auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(redirect);
      })
      .catch(() => { /* session check failed — stay on landing */ });
  }, [authClient, router, redirect, searchParams]);

  function handleOpenAuth(query?: string) {
    if (query) {
      const encoded = encodeURIComponent(query);
      setPendingRedirect(`/chat?q=${encoded}`);
    }
    setShowLoginModal(true);
  }

  return (
    <>
      <LandingPage onOpenAuth={handleOpenAuth} />
      {showLoginModal && (
        <LoginModal
          redirect={pendingRedirect}
          onClose={() => setShowLoginModal(false)}
        />
      )}
    </>
  );
}
