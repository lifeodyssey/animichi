"use client";

import { useLocale } from "../../lib/i18n-context";
import { ANIME_GALLERY } from "./LandingData";
import SharedHeader from "../layout/SharedHeader";
import SharedFooter from "../layout/SharedFooter";
import LandingHero from "./LandingHero";
import { LandingHowItWorks } from "./LandingHowItWorks";
import { LandingPopularRoutes } from "./LandingPopularRoutes";
import { LandingSaveSync } from "./LandingSaveSync";

interface LandingPageProps {
  onOpenAuth: (query?: string) => void;
}

export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const locale = useLocale();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background font-sans" lang={locale}>
      <SharedHeader onLogin={onOpenAuth} position="fixed" />

      {/* ═══════ SECTION 1: HERO ═══════ */}
      <LandingHero onOpenAuth={onOpenAuth} />

      {/* ═══════ SECTION 2: HOW IT WORKS (48px top spacing) ═══════ */}
      <div className="mt-12">
        <LandingHowItWorks />
      </div>

      {/* ═══════ SECTION 3: POPULAR ROUTES (48px top spacing) ═══════ */}
      <div className="mt-12">
        <LandingPopularRoutes items={ANIME_GALLERY} onOpenAuth={onOpenAuth} />
      </div>

      {/* ═══════ SECTION 4: SAVE-SYNC (48px top spacing) ═══════ */}
      <div className="mt-12">
        <LandingSaveSync onOpenAuth={onOpenAuth} />
      </div>

      <SharedFooter />
    </div>
  );
}
