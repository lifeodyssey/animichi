"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../lib/supabase";
import { useDict } from "../../lib/i18n-context";
import AppShell from "../../components/layout/AppShell";

export default function ChatPage() {
  const router = useRouter();
  const t = useDict().auth;
  const authClient = getSupabaseClient();

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!authClient);

  useEffect(() => {
    if (!authClient) return;
    authClient.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) {
        router.replace("/?login=true");
        return;
      }
      setSession(s);
      setLoading(false);
    });
    const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        router.replace("/?login=true");
        return;
      }
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, [authClient, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{t.loading}</div>
      </div>
    );
  }

  if (!session) return null;

  return <AppShell />;
}
