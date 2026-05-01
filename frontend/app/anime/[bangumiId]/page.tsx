"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDict, useLocale } from "../../../lib/i18n-context";
import { fetchAnimeGuide } from "../../../lib/api";
import type { AnimeGuideResponse } from "../../../lib/api";
import type { PilgrimagePoint } from "../../../lib/types";
import { useScrollReveal } from "../../../hooks/useScrollReveal";
import SharedHeader from "../../../components/layout/SharedHeader";
import SharedFooter from "../../../components/layout/SharedFooter";
import Filmstrip from "../../../components/spots/Filmstrip";
import SpotGroup from "../../../components/spots/SpotGroup";
import GroupToggle from "../../../components/spots/GroupToggle";

const LazyMap = dynamic(() => import("../../../components/map/BaseMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[var(--color-card)] text-[14px] text-[var(--color-muted-fg)]">
      Loading map…
    </div>
  ),
});

/* ── Reducer ── */

type Status = "loading" | "done" | "not_found" | "error";
type State = { data: AnimeGuideResponse | null; status: Status };
type Action =
  | { type: "fetch" }
  | { type: "done"; data: AnimeGuideResponse }
  | { type: "not_found" }
  | { type: "error" };

function reducer(_: State, action: Action): State {
  switch (action.type) {
    case "fetch": return { data: null, status: "loading" };
    case "done": return { data: action.data, status: "done" };
    case "not_found": return { data: null, status: "not_found" };
    case "error": return { data: null, status: "error" };
  }
}

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

/** Map lat/lng to a rough Japanese region name. */
const REGIONS: Array<{ lat: [number, number]; lng: [number, number]; name: string }> = [
  { lat: [35.6, 35.8], lng: [139.6, 139.9], name: "東京" },
  { lat: [34.6, 35.1], lng: [135.4, 135.9], name: "京都・宇治" },
  { lat: [34.6, 34.8], lng: [135.0, 135.5], name: "大阪・神戸" },
  { lat: [34.6, 34.9], lng: [135.2, 135.5], name: "西宮・阪神" },
  { lat: [36.1, 36.3], lng: [137.1, 137.3], name: "飛騨高山" },
  { lat: [35.0, 35.2], lng: [135.7, 136.0], name: "滋賀" },
  { lat: [33.5, 34.0], lng: [130.0, 131.5], name: "九州" },
  { lat: [35.3, 35.5], lng: [139.4, 139.7], name: "横浜" },
  { lat: [34.9, 35.1], lng: [136.8, 137.0], name: "名古屋" },
];

function areaName(points: PilgrimagePoint[]): string {
  // Use origin field if available
  for (const p of points) {
    if (p.origin && p.origin.trim()) return p.origin.trim();
  }
  // Match against known regions
  const first = points[0];
  if (!first) return "その他";
  for (const r of REGIONS) {
    if (first.latitude >= r.lat[0] && first.latitude <= r.lat[1]
      && first.longitude >= r.lng[0] && first.longitude <= r.lng[1]) {
      return r.name;
    }
  }
  // Fallback: use spot name as hint
  const names = points.slice(0, 3).map((p) => p.name).join("・");
  return names.length > 20 ? `${names.slice(0, 18)}…` : names;
}

function groupByArea(spots: PilgrimagePoint[], bangumiCity?: string | null): SpotGroupData[] {
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
    // First (largest) group uses bangumi city name if available
    title: i === 0 && bangumiCity ? bangumiCity : areaName(points),
    points,
  }));
}

/** Merge spots with the same name + coordinates. Keeps first screenshot, collects all episodes. */
function deduplicateSpots(spots: PilgrimagePoint[]): PilgrimagePoint[] {
  const map = new Map<string, PilgrimagePoint>();
  for (const s of spots) {
    const key = `${s.name}|${Math.round(s.latitude * 1000)}|${Math.round(s.longitude * 1000)}`;
    if (!map.has(key)) {
      map.set(key, { ...s });
    }
    // Could merge episodes here if we had an episodes[] field
  }
  return [...map.values()];
}

/** Pick ~1 representative spot per episode group for the filmstrip (max 12). */
function selectFilmstripSpots(spots: PilgrimagePoint[], maxCount: number = 12): PilgrimagePoint[] {
  const withScreenshot = spots.filter((s) => s.screenshot_url);
  if (withScreenshot.length <= maxCount) return withScreenshot;

  // Pick evenly spaced samples
  const step = Math.max(1, Math.floor(withScreenshot.length / maxCount));
  const selected: PilgrimagePoint[] = [];
  for (let i = 0; i < withScreenshot.length && selected.length < maxCount; i += step) {
    selected.push(withScreenshot[i]);
  }
  return selected;
}

function shouldDefaultToEpisode(spots: PilgrimagePoint[]): boolean {
  const withEp = spots.filter((s) => s.episode != null && s.episode > 0);
  return withEp.length > spots.length * 0.4;
}

/* ── Page ── */

export default function AnimeGuidePage() {
  const { bangumiId } = useParams<{ bangumiId: string }>();
  const dict = useDict();
  const t = dict.anime_guide;
  const locale = useLocale() as "ja" | "zh" | "en";
  const addRevealRef = useScrollReveal();

  const [{ data, status }, dispatch] = useReducer(reducer, {
    data: null,
    status: "loading",
  });

  useEffect(() => {
    if (!bangumiId) return;
    const controller = new AbortController();
    dispatch({ type: "fetch" });
    fetchAnimeGuide(bangumiId, controller.signal)
      .then((res) => {
        if (res) dispatch({ type: "done", data: res });
        else dispatch({ type: "not_found" });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        dispatch({ type: "error" });
      });
    return () => controller.abort();
  }, [bangumiId]);

  const spots = useMemo(() => deduplicateSpots(data?.spots ?? []), [data]);
  const filmstripSpots = useMemo(() => selectFilmstripSpots(spots), [spots]);
  const title = data?.title ?? "";
  const titleCn = data?.title_cn;
  const displayTitle = locale === "zh" && titleCn ? titleCn : title;

  const defaultMode = useMemo(
    () => (shouldDefaultToEpisode(spots) ? "episode" : "area"),
    [spots],
  );
  const [groupMode, setGroupMode] = useState<"episode" | "area">(defaultMode);

  // Reset group mode when data changes
  useEffect(() => { setGroupMode(defaultMode); }, [defaultMode]);

  const groups = useMemo(
    () => (groupMode === "episode" ? groupByEpisode(spots, t.episode_group, t.other_group) : groupByArea(spots, data?.city)),
    [spots, groupMode, data?.city, t.episode_group, t.other_group],
  );

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)]"
      style={{ fontFamily: "var(--app-font-body)" }}
    >
      <SharedHeader loginHref="/?login=true" />

      {/* Loading */}
      {status === "loading" && (
        <div className="flex items-center justify-center py-32 text-[16px] text-[var(--color-muted-fg)]" role="status" aria-label={t.loading}>
          <span className="mr-3 inline-block h-4 w-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent" style={{ animation: "spin 0.8s linear infinite" }} />
          {t.loading}
        </div>
      )}

      {/* Not found */}
      {status === "not_found" && (
        <div className="py-32 text-center">
          <p className="text-[18px] font-medium text-[var(--color-fg)]">{t.not_found}</p>
          <p className="mt-2 text-[14px] text-[var(--color-muted-fg)]">{t.not_found_hint}</p>
          <Link href="/" className="mt-6 inline-block text-[14px] text-[var(--color-primary)] hover:underline">{t.back_to_home}</Link>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="py-32 text-center">
          <p className="text-[16px] text-[var(--color-muted-fg)]">{t.error}</p>
          <Link href="/" className="mt-4 inline-block text-[14px] text-[var(--color-primary)] hover:underline">{t.back_to_home}</Link>
        </div>
      )}

      {/* Guide content — Variant E: Filmstrip + Map */}
      {status === "done" && data && (
        <>
          {/* Hero */}
          <section
            className="px-5 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-14"
            style={{
              background: "linear-gradient(160deg, oklch(90% 0.03 220), var(--color-bg))",
              animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <div className="mx-auto max-w-[1200px]">
              <Link
                href="/"
                className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
              >
                <span aria-hidden="true">←</span>
                {t.back_to_home}
              </Link>

              <div className="flex items-start gap-6">
                {data.cover_url && (
                  <img
                    src={data.cover_url}
                    alt={displayTitle}
                    width={140}
                    height={198}
                    className="h-[160px] w-[113px] shrink-0 rounded-lg object-cover shadow-md sm:h-[198px] sm:w-[140px] lg:h-[240px] lg:w-[170px]"
                  />
                )}
                <div>
                  <h1 className="font-[family-name:var(--app-font-display)] text-[clamp(28px,4.5vw,42px)] font-bold leading-[1.1] text-[var(--color-fg)]">
                    {displayTitle}
                  </h1>
                  {titleCn && locale !== "zh" && (
                    <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{titleCn}</p>
                  )}
                  {locale === "zh" && title !== titleCn && (
                    <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{title}</p>
                  )}
                  <div className="mt-4 flex items-center gap-3 text-[14px] text-[var(--color-muted-fg)]">
                    <span className="font-semibold text-[var(--color-fg)]">
                      {t.spots_label.replace("{count}", String(data.spot_count))}
                    </span>
                    {data.city && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>{data.city}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Filmstrip — gradient bridge from hero to content */}
          {filmstripSpots.length > 0 && (
            <div
              className="pb-4"
              style={{
                background: "linear-gradient(180deg, oklch(93% 0.02 220) 0%, var(--color-bg) 100%)",
                animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s backwards",
              }}
            >
              <Filmstrip points={filmstripSpots} label={t.filmstrip_label} />
            </div>
          )}

          <main className="mx-auto max-w-[1200px] px-5 pb-16 sm:px-8 sm:pb-20">
            {/* Map */}
            {spots.length > 0 && (
              <div
                className="mb-6 mt-6 overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-sm"
                style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.15s backwards" }}
              >
                <div className="h-[320px] sm:h-[420px] lg:h-[480px]">
                  <LazyMap points={spots} height="100%" scrollWheelZoom={false} />
                </div>
              </div>
            )}

            {/* CTA */}
            <div
              className="mb-10 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm sm:flex sm:items-center sm:justify-between sm:p-8"
              style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.2s backwards" }}
            >
              <div>
                <p className="text-[18px] font-semibold text-[var(--color-fg)]">{t.plan_route}</p>
                <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{t.plan_route_sub}</p>
              </div>
              <Link
                href={`/chat?q=${encodeURIComponent(locale === "zh" && titleCn ? titleCn : title)}`}
                className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[var(--color-primary)] px-7 text-[14px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90 sm:mt-0"
              >
                {t.plan_route}
                <span aria-hidden="true">→</span>
              </Link>
            </div>

            {/* Group toggle + spot groups */}
            {groups.length > 1 && (
              <div
                className="mb-4"
                style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.25s backwards" }}
              >
                <GroupToggle
                  value={groupMode}
                  onChange={setGroupMode}
                  episodeLabel={t.episode_tab}
                  areaLabel={t.area_tab}
                />
              </div>
            )}

            <div style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.3s backwards" }}>
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
    </div>
  );
}
