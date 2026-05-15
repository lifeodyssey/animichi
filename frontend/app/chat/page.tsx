"use client";

import { useSearchParams } from "next/navigation";
import AppShell from "../../components/layout/AppShell";

/**
 * Chat page — protected by middleware.ts (session cookie required).
 * Accepts `?q=` query param to auto-send a search (e.g. from guide page CTA).
 */
export default function ChatPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? undefined;
  return <AppShell initialQuery={initialQuery} />;
}
