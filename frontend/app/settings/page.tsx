"use client";

import ApiKeysPage from "@/components/settings/ApiKeysPage";

/**
 * Settings page — protected by middleware.ts (session cookie required).
 * No client-side auth check needed.
 */
export default function SettingsPage() {
  return <ApiKeysPage />;
}
