"use client";

import AppShell from "../../components/layout/AppShell";

/**
 * Chat page — protected by middleware.ts (session cookie required).
 * No client-side auth check needed.
 */
export default function ChatPage() {
  return <AppShell />;
}
