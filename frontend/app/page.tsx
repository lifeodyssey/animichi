"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../lib/supabase/browser";
import { safeRedirect } from "../lib/safe-redirect";
import LandingPage from "../components/auth/LandingPage";
import LoginModal from "../components/auth/LoginModal";

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authClient = createClient();

  const redirect = safeRedirect(searchParams.get("redirect"));
  const [showLoginModal, setShowLoginModal] = useState(
    searchParams.get("login") === "true",
  );

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

  return (
    <>
      <LandingPage onOpenAuth={() => setShowLoginModal(true)} />
      {showLoginModal && (
        <LoginModal
          redirect={redirect}
          onClose={() => setShowLoginModal(false)}
        />
      )}
    </>
  );
}
