"use client";

import { useLocale } from "../../lib/i18n-context";
import { ANIME_GALLERY } from "./LandingData";
import SharedFooter from "../layout/SharedFooter";
import LandingHeader from "./LandingHeader";
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
    <div id="top" className="overflow-x-hidden bg-background font-sans" lang={locale}>
      <LandingHeader onLogin={onOpenAuth} />

      {/* ═══════ SECTION 1: HERO ═══════ */}
      <LandingHero onOpenAuth={onOpenAuth} />

      {/* ═══════ SECTION 2: HOW IT WORKS ═══════ */}
      <div id="how-it-works">
        <LandingHowItWorks />
      </div>

      {/* ═══════ SECTION 3: POPULAR ROUTES ═══════ */}
      <div id="popular-routes">
        <LandingPopularRoutes items={ANIME_GALLERY} onOpenAuth={onOpenAuth} />
      </div>

      {/* ═══════ SECTION 4: SAVE-SYNC ═══════ */}
      <div id="save-sync">
        <LandingSaveSync onOpenAuth={onOpenAuth} />
      </div>

      <SharedFooter />
    </div>
  );
}
