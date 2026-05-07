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

  // If already logged in, go to redirect target
  useEffect(() => {
    if (!authClient) return;
    authClient.auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(redirect);
      })
      .catch(() => { /* session check failed — stay on landing */ });
  }, [authClient, router, redirect]);

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
