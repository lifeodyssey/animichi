"use client";

import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "../../../lib/i18n-context";
import type { AnimeGuideResponse } from "../../../lib/api";
import type { PilgrimagePoint } from "../../../lib/types";
import { useScrollReveal } from "../../../hooks/useScrollReveal";
import { createClient } from "../../../lib/supabase/browser";
import SharedHeader from "../../../components/layout/SharedHeader";
import SharedFooter from "../../../components/layout/SharedFooter";
import SpotGroup from "../../../components/spots/SpotGroup";
import GroupToggle from "../../../components/spots/GroupToggle";
import LoginModal from "../../../components/auth/LoginModal";
import { Button } from "../../../components/ui/button";

/* ── Map Error Boundary ── */

class MapErrorBoundary extends Component<{ children: ReactNode; fallbackText: string }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallbackText: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Map failed to load:", error, info);
  }
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-secondary/50 text-sm text-muted-foreground">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>{this.props.fallbackText}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

const LazyMap = dynamic(() => import("../../../components/map/BaseMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-card">
      <div className="skeleton h-full w-full" />
    </div>
  ),
});

/* ── Grouping helpers ── */

interface SpotGroupData {
  key: string;
  title: string;
  points: PilgrimagePoint[];
}

function groupByEpisode(spots: PilgrimagePoint[], epLabel: string, otherLabel: string): SpotGroupData[] {
  const withEp = new Map<number, PilgrimagePoint[]>();
  const noEp: PilgrimagePoint[] = [];
  for (const s of spots) {
    const ep = s.episode;
    if (ep != null && ep > 0) {
      const arr = withEp.get(ep) ?? [];
      arr.push(s);
      withEp.set(ep, arr);
    } else {
      noEp.push(s);
    }
  }
  const sorted = [...withEp.entries()].sort(([a], [b]) => a - b);
  const groups: SpotGroupData[] = sorted.map(([ep, points]) => ({
    key: `ep-${ep}`,
    title: epLabel.replace("{ep}", String(ep)),
    points,
  }));
  if (noEp.length > 0) {
    groups.push({ key: "ep-other", title: otherLabel, points: noEp });
  }
  return groups;
}

interface RegionEntry {
  lat: [number, number];
  lng: [number, number];
  ja: string;
  zh: string;
  en: string;
}

const REGIONS: RegionEntry[] = [
  { lat: [35.6, 35.8], lng: [139.6, 139.9], ja: "東京", zh: "东京", en: "Tokyo" },
  { lat: [34.6, 35.1], lng: [135.4, 135.9], ja: "京都・宇治", zh: "京都・宇治", en: "Kyoto / Uji" },
  { lat: [34.6, 34.8], lng: [135.0, 135.5], ja: "大阪・神戸", zh: "大阪・神户", en: "Osaka / Kobe" },
  { lat: [34.6, 34.9], lng: [135.2, 135.5], ja: "西宮・阪神", zh: "西宫・阪神", en: "Nishinomiya" },
  { lat: [36.1, 36.3], lng: [137.1, 137.3], ja: "飛騨高山", zh: "飞驒高山", en: "Hida Takayama" },
  { lat: [35.0, 35.2], lng: [135.7, 136.0], ja: "滋賀", zh: "滋贺", en: "Shiga" },
  { lat: [33.5, 34.0], lng: [130.0, 131.5], ja: "九州", zh: "九州", en: "Kyushu" },
  { lat: [35.3, 35.5], lng: [139.4, 139.7], ja: "横浜", zh: "横滨", en: "Yokohama" },
  { lat: [34.9, 35.1], lng: [136.8, 137.0], ja: "名古屋", zh: "名古屋", en: "Nagoya" },
];

function areaName(points: PilgrimagePoint[], locale: string, otherLabel: string): string {
  for (const p of points) {
    if (p.origin && p.origin.trim()) return p.origin.trim();
  }
  const first = points[0];
  if (!first) return otherLabel;
  const lang = (locale === "zh" ? "zh" : locale === "en" ? "en" : "ja") as keyof Pick<RegionEntry, "ja" | "zh" | "en">;
  for (const r of REGIONS) {
    if (first.latitude >= r.lat[0] && first.latitude <= r.lat[1]
      && first.longitude >= r.lng[0] && first.longitude <= r.lng[1]) {
      return r[lang];
    }
  }
  const names = points.slice(0, 3).map((p) => locale === "zh" && p.name_cn ? p.name_cn : p.name).join("・");
  return names.length > 20 ? `${names.slice(0, 18)}…` : names;
}

function groupByArea(spots: PilgrimagePoint[], locale: string, otherLabel: string, bangumiCity?: string | null): SpotGroupData[] {
  const map = new Map<string, PilgrimagePoint[]>();
  for (const s of spots) {
    const lat = Math.round((s.latitude || 0) * 10) / 10;
    const lng = Math.round((s.longitude || 0) * 10) / 10;
    const key = `${lat},${lng}`;
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  const sorted = [...map.entries()].sort(([, a], [, b]) => b.length - a.length);
  return sorted.map(([key, points], i) => ({
    key: `area-${key}`,
    title: i === 0 && bangumiCity ? bangumiCity : areaName(points, locale, otherLabel),
    points,
  }));
}

function deduplicateSpots(spots: PilgrimagePoint[]): PilgrimagePoint[] {
  const map = new Map<string, PilgrimagePoint>();
  for (const s of spots) {
    const key = `${s.name}|${Math.round(s.latitude * 1000)}|${Math.round(s.longitude * 1000)}`;
    if (!map.has(key)) map.set(key, { ...s });
  }
  return [...map.values()];
}

function shouldDefaultToEpisode(spots: PilgrimagePoint[]): boolean {
  const withEp = spots.filter((s) => s.episode != null && s.episode > 0);
  return withEp.length > spots.length * 0.4;
}

/* ── Client Component ── */

interface AnimeGuideClientProps {
  initialData: AnimeGuideResponse | null;
  bangumiId: string;
}

export default function AnimeGuideClient({ initialData, bangumiId }: AnimeGuideClientProps) {
  const router = useRouter();
  const dict = useDict();
  const t = dict.anime_guide;
  const locale = useLocale() as "ja" | "zh" | "en";
  const addRevealRef = useScrollReveal();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });
  }, []);

  const status: "done" | "not_found" = initialData ? "done" : "not_found";

  const spots = useMemo(() => deduplicateSpots(initialData?.spots ?? []), [initialData]);
  const title = initialData?.title ?? "";
  const titleCn = initialData?.title_cn;
  const displayTitle = locale === "zh" && titleCn ? titleCn : title;

  const defaultMode = useMemo(
    () => (shouldDefaultToEpisode(spots) ? "episode" : "area"),
    [spots],
  );

  const storageKey = `guide-${bangumiId}`;
  const [groupMode, setGroupMode] = useState<"episode" | "area">(() => {
    if (typeof window === "undefined") return defaultMode;
    const saved = sessionStorage.getItem(storageKey);
    return saved === "episode" || saved === "area" ? saved : defaultMode;
  });

  const handleGroupModeChange = (mode: "episode" | "area") => {
    setGroupMode(mode);
    sessionStorage.setItem(storageKey, mode);
  };

  useEffect(() => {
    const scrollKey = `${storageKey}-scroll`;
    const savedY = sessionStorage.getItem(scrollKey);
    if (savedY && status === "done") {
      requestAnimationFrame(() => window.scrollTo(0, Number(savedY)));
      sessionStorage.removeItem(scrollKey);
    }
    const saveScroll = () => sessionStorage.setItem(scrollKey, String(window.scrollY));
    window.addEventListener("beforeunload", saveScroll);
    return () => window.removeEventListener("beforeunload", saveScroll);
  }, [storageKey, status]);

  const groups = useMemo(
    () => (groupMode === "episode" ? groupByEpisode(spots, t.episode_group, t.other_group) : groupByArea(spots, locale, t.other_group, initialData?.city)),
    [spots, groupMode, locale, initialData?.city, t.episode_group, t.other_group],
  );

  return (
    <div className="min-h-screen bg-background font-sans">
      <SharedHeader loginHref="/?login=true" />

      {status === "not_found" && (
        <div className="py-32 text-center">
          <p className="text-lg font-medium text-foreground">{t.not_found}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t.not_found_hint}</p>
          <Link href="/" className="mt-6 inline-block text-sm text-primary hover:underline">{t.back_to_home}</Link>
        </div>
      )}

      {status === "done" && initialData && (
        <>
          {/* Hero */}
          <section className="entrance-up bg-gradient-soft px-5 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-14">
            <div className="mx-auto max-w-[1200px]">
              <Link
                href="/"
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <span aria-hidden="true">←</span>
                {t.back_to_home}
              </Link>

              <div className="flex items-start gap-6">
                {initialData.cover_url && (
                  <img
                    src={initialData.cover_url}
                    alt={displayTitle}
                    width={140}
                    height={198}
                    className="h-[160px] w-[113px] shrink-0 rounded-lg object-cover shadow-[var(--shadow-card)] sm:h-[198px] sm:w-[140px] lg:h-[240px] lg:w-[170px]"
                  />
                )}
                <div>
                  <h1 className="font-display text-[clamp(28px,4.5vw,42px)] font-bold leading-[1.1] text-foreground">
                    {displayTitle}
                  </h1>
                  {titleCn && locale !== "zh" && (
                    <p className="mt-1 text-sm text-muted-foreground">{titleCn}</p>
                  )}
                  {locale === "zh" && title !== titleCn && (
                    <p className="mt-1 text-sm text-muted-foreground">{title}</p>
                  )}
                  <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {t.spots_label.replace("{count}", String(initialData.spot_count))}
                    </span>
                    {initialData.city && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>{initialData.city}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <main className="mx-auto max-w-[1200px] px-5 pb-16 sm:px-8 sm:pb-20">
            {spots.length > 0 && (
              <div
                className="entrance-up mb-6 mt-6 overflow-hidden rounded-2xl border-2 border-border shadow-[var(--shadow-card)] [animation-delay:0.15s]"
              >
                <div className="h-[320px] sm:h-[420px] lg:h-[480px]">
                  <MapErrorBoundary fallbackText={t.map_unavailable ?? "Map unavailable — view spot locations below"}>
                    <LazyMap points={spots} height="100%" scrollWheelZoom={false} />
                  </MapErrorBoundary>
                </div>
              </div>
            )}

            <div
              className="entrance-up mb-10 rounded-2xl border-2 border-border bg-card p-6 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-card-hover)] sm:flex sm:items-center sm:justify-between sm:p-8 [animation-delay:0.2s]"
            >
              <div>
                <p className="text-lg font-semibold text-foreground">{t.plan_route}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.plan_route_sub}</p>
              </div>
              <Button
                variant="cta"
                size="lg"
                onClick={() => {
                  sessionStorage.setItem(`${storageKey}-scroll`, String(window.scrollY));
                  const q = encodeURIComponent(locale === "zh" && titleCn ? titleCn : title);
                  if (isLoggedIn) {
                    router.push(`/chat?q=${q}`);
                  } else {
                    setShowLoginModal(true);
                  }
                }}
                className="mt-3 sm:mt-0"
              >
                {t.plan_route}
                <span aria-hidden="true">→</span>
              </Button>
            </div>

            {groups.length > 1 && (
              <div className="entrance-up mb-4 [animation-delay:0.25s]">
                <GroupToggle
                  value={groupMode}
                  onChange={handleGroupModeChange}
                  episodeLabel={t.episode_tab}
                  areaLabel={t.area_tab}
                />
              </div>
            )}

            <div className="entrance-up [animation-delay:0.3s]">
              {groups.map((group, i) => (
                <SpotGroup
                  key={group.key}
                  title={group.title}
                  count={group.points.length}
                  points={group.points}
                  defaultOpen={i === 0}
                  revealRef={addRevealRef}
                  showAllLabel={t.show_all}
                  spotsCountLabel={t.spots_count}
                />
              ))}
            </div>
          </main>

          <SharedFooter />
        </>
      )}
      {showLoginModal && (
        <LoginModal
          redirect={`/chat?q=${encodeURIComponent(locale === "zh" && titleCn ? titleCn : title)}`}
          onClose={() => setShowLoginModal(false)}
        />
      )}
    </div>
  );
}
