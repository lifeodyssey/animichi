"use client";

import { useState, useCallback, useTransition, useId } from "react";
import { Bookmark, Smartphone, History, Mail, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ExploreButton } from "@/components/ui/explore-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import RouteLine from "@/components/landing/decor/RouteLine";
import Stamp from "@/components/landing/decor/Stamp";
import TicketStub from "@/components/landing/decor/TicketStub";
import LeafSprig from "@/components/landing/decor/LeafSprig";
import FoxGuide from "@/components/generative/FoxGuide";
import { useDict } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";

// ── Left: the journal notebook ───────────────────────────────────────────────

const JOURNAL_SPOTS = [
  { n: 1, name: "四ツ谷駅", roman: "Yotsuya Station" },
  { n: 2, name: "須賀神社 階段", roman: "Suga Shrine Steps" },
  { n: 3, name: "新宿御苑", roman: "Shinjuku Gyoen" },
];

function NotebookCard() {
  return (
    <div className="paper-surface relative rounded-[20px] pl-10 pr-6 py-6 sm:pl-12">
      {/* Spiral binding */}
      <div className="absolute inset-y-5 left-3 flex flex-col justify-between" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="size-2.5 rounded-full border-2 border-border bg-background" />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-[17px] font-bold text-fg-heading">
          新宿・須賀神社 階段巡礼
        </p>
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground">
          2025.05.18
        </span>
      </div>

      {/* Mini route map */}
      <div className="relative mt-4 h-24 overflow-hidden rounded-[12px] border border-border bg-walk-bg/50">
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
          <RouteLine stops={1} />
        </div>
      </div>

      {/* Numbered spots */}
      <ol className="mt-4 flex flex-col gap-2.5">
        {JOURNAL_SPOTS.map((s) => (
          <li key={s.n} className="flex items-center gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
              {s.n}
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] font-bold text-fg">{s.name}</span>
              <span className="block text-[11px] text-muted-foreground">{s.roman}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center justify-between">
        <TicketStub label="聖地巡礼きっぷ" sub="TYO → 新宿" rotate={-4} />
        <Stamp ringText="旅の記録" glyph="compass" size={56} rotate={8} />
      </div>
    </div>
  );
}

// ── Right: features + save card ──────────────────────────────────────────────

const FEATURE_ICONS = [Bookmark, Smartphone, History];

/** Shape check only — advisory, never blocks submit (the field is a teaser). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Features({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-7 gap-y-4">
      {FEATURE_ICONS.map((Icon, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-primary/12">
            <Icon size={16} className="text-primary" aria-hidden="true" />
          </span>
          <span className="max-w-[120px] text-[12px] font-medium leading-snug text-fg">
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function SaveCard({
  cardTitle,
  cardSub,
  emailPlaceholder,
  emailHint,
  emailHintAt,
  magiclinkQ,
  magiclinkA,
  saveCta,
  browseCta,
  onSave,
}: {
  cardTitle: string;
  cardSub: string;
  emailPlaceholder: string;
  emailHint: string;
  emailHintAt: string;
  magiclinkQ: string;
  magiclinkA: string;
  saveCta: string;
  browseCta: string;
  onSave: () => void;
}) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hintId = useId();

  // Advisory only: a typo is flagged after blur, but submit is never blocked —
  // the field is an optional teaser and "Save my route" always opens the modal.
  const showHint = touched && email.trim() !== "" && !EMAIL_RE.test(email.trim());
  // Pinpoint the most common fault so recovery guidance is specific, not generic.
  const hintMessage = email.includes("@") ? emailHint : emailHintAt;

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      startTransition(() => onSave());
    },
    [onSave],
  );

  return (
    <div className="relative rounded-[20px] border border-border bg-card p-6 shadow-card" role="region" aria-label={cardTitle}>
      <h3 className="font-display text-[15px] font-bold text-fg-heading">{cardTitle}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{cardSub}</p>

      <form onSubmit={handleSend} className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={emailPlaceholder}
            aria-label={emailPlaceholder}
            aria-invalid={showHint || undefined}
            aria-describedby={showHint ? hintId : undefined}
            status={showHint ? "warning" : undefined}
            inputMode="email"
            autoComplete="email"
            prefix={<Mail size={15} aria-hidden="true" />}
            shadow
            size="large"
          />
          {showHint && (
            <p id={hintId} role="status" className="text-[12px] leading-snug text-warning-fg">
              {hintMessage}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <ExploreButton
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            className={cn("w-full py-3 text-[13px]", isPending && "opacity-70")}
            data-testid="ss-save-cta"
          >
            {saveCta}
          </ExploreButton>
          <a
            href="#popular-routes"
            className="text-center text-[13px] font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-fg hover:underline"
            data-testid="ss-browse-cta"
          >
            {browseCta}
          </a>
        </div>
      </form>

      <TooltipProvider delay={120}>
        <Tooltip>
          <TooltipTrigger
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            data-testid="ss-magiclink-trigger"
          >
            <Info size={13} aria-hidden="true" />
            {magiclinkQ}
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-left leading-relaxed">
            {magiclinkA}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface LandingSaveSyncProps {
  onOpenAuth: (query?: string) => void;
}

export function LandingSaveSync({ onOpenAuth }: LandingSaveSyncProps) {
  const dict = useDict();
  const t = dict.landing_hero.landing;
  const addRevealRef = useScrollReveal();

  return (
    <section
      data-testid="save-sync-section"
      className="relative overflow-hidden border-t border-border bg-card px-5 pb-24 pt-16 sm:px-8 sm:pt-20"
    >
      <LeafSprig size={40} className="absolute right-8 top-8 hidden -rotate-12 lg:block" />
      <div className="mx-auto max-w-[1100px]">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: notebook */}
          <div ref={addRevealRef} className="seichi-reveal-pop relative order-2 lg:order-1">
            <NotebookCard />
            <FoxGuide pose="cheer" size="md" surface="welcome" className="-bottom-6 -right-2 hidden lg:block" />
          </div>

          {/* Right: copy + features + save card */}
          <div ref={addRevealRef} className="seichi-reveal order-1 flex flex-col gap-6 lg:order-2">
            <h2 className="max-w-[480px] font-display text-[clamp(24px,3.6vw,38px)] font-bold leading-tight text-fg-heading text-balance">
              {t.ss_title}
            </h2>
            <p className="max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
              {t.ss_sub}
            </p>
            <Features labels={[t.ss_feature1, t.ss_feature2, t.ss_feature3]} />
            <SaveCard
              cardTitle={t.ss_card_title}
              cardSub={t.ss_card_sub}
              emailPlaceholder={t.ss_email_placeholder}
              emailHint={t.ss_email_hint}
              emailHintAt={t.ss_email_hint_at}
              magiclinkQ={t.ss_magiclink_q}
              magiclinkA={t.ss_magiclink_a}
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
