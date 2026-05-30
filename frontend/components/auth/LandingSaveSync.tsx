"use client";

import { useState, useCallback, useTransition } from "react";
import { Bookmark, Smartphone, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";

// ── Feature bullets ────────────────────────────────────────────────────────────

const FEATURE_ICONS = [Bookmark, Smartphone, History];

interface FeatureItem {
  icon: React.ElementType;
  label: string;
}

function FeatureBullet({ icon: Icon, label }: FeatureItem) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon size={15} className="text-primary" aria-hidden="true" />
      </span>
      <span className="text-[13px] text-foreground">{label}</span>
    </li>
  );
}

// ── Magic-link card ────────────────────────────────────────────────────────────

interface MagicLinkCardProps {
  cardTitle: string;
  cardSub: string;
  emailPlaceholder: string;
  saveCta: string;
  browseCta: string;
  onSave: () => void;
}

function MagicLinkCard({
  cardTitle,
  cardSub,
  emailPlaceholder,
  saveCta,
  browseCta,
  onSave,
}: Omit<MagicLinkCardProps, "sendCta">) {
  const [email, setEmail] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      startTransition(() => {
        onSave();
      });
    },
    [onSave],
  );

  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-2xl border border-border bg-card p-6",
        "shadow-[var(--shadow-popup)]",
      )}
      role="region"
      aria-label={cardTitle}
    >
      <h3 className="font-display text-[15px] font-bold text-foreground">{cardTitle}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{cardSub}</p>

      <form onSubmit={handleSend} className="mt-4 flex flex-col gap-3">
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={emailPlaceholder}
          aria-label={emailPlaceholder}
          inputMode="email"
          autoComplete="email"
          className={cn(
            "w-full rounded-full border border-border bg-background px-4 py-2.5",
            "text-[13px] text-foreground placeholder:text-muted-foreground",
            "shadow-[var(--shadow-3d)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]",
          )}
        />
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className={cn(
            "flex h-11 w-full items-center justify-center rounded-full",
            "bg-cta text-[13px] font-semibold text-cta-foreground",
            "shadow-[var(--shadow-3d)] transition-transform active:translate-y-0.5",
            isPending && "cursor-not-allowed opacity-60",
          )}
          data-testid="ss-save-cta"
        >
          {saveCta}
        </button>
      </form>

      <button
        type="button"
        onClick={onSave}
        className="mt-3 w-full text-center text-[12px] text-muted-foreground underline-offset-2 hover:underline"
        data-testid="ss-browse-cta"
      >
        {browseCta}
      </button>
    </div>
  );
}

// ── Public component ───────────────────────────────────────────────────────────

export interface LandingSaveSyncProps {
  onOpenAuth: (query?: string) => void;
}

export function LandingSaveSync({ onOpenAuth }: LandingSaveSyncProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  const featureLabels = [t.ss_feature1, t.ss_feature2, t.ss_feature3];

  const features: FeatureItem[] = FEATURE_ICONS.map((icon, i) => ({
    icon,
    label: featureLabels[i],
  }));

  return (
    <section
      data-testid="save-sync-section"
      className="bg-card px-5 py-16 sm:px-8"
    >
      <div className="mx-auto max-w-[1100px]">
        <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-start lg:gap-16">
          {/* ── Left: copy ── */}
          <div
            ref={addRevealRef}
            className="seichi-reveal flex flex-1 flex-col gap-6"
          >
            <h2
              className={cn(
                "font-display text-[clamp(22px,3.5vw,36px)] font-bold leading-tight text-foreground",
                "max-w-[560px] text-balance",
              )}
            >
              {t.ss_title}
            </h2>
            <p className="max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
              {t.ss_sub}
            </p>
            <ul className="flex flex-col gap-3">
              {features.map((f) => (
                <FeatureBullet key={f.label} {...f} />
              ))}
            </ul>
          </div>

          {/* ── Right: magic-link card ── */}
          <div
            ref={addRevealRef}
            className="seichi-reveal-pop w-full lg:w-auto"
          >
            <MagicLinkCard
              cardTitle={t.ss_card_title}
              cardSub={t.ss_card_sub}
              emailPlaceholder={t.ss_email_placeholder}
              saveCta={t.ss_save_cta}
              browseCta={t.ss_browse_cta}
              onSave={onOpenAuth}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
