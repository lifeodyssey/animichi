"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDict, useLocale } from "../../../lib/i18n-context";
import { fetchAnimeGuide } from "../../../lib/api";
import type { AnimeGuideResponse } from "../../../lib/api";
import type { PilgrimagePoint } from "../../../lib/types";
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

function groupByEpisode(spots: PilgrimagePoint[]): SpotGroupData[] {
  const map = new Map<number, PilgrimagePoint[]>();
  for (const s of spots) {
    const ep = s.episode ?? 0;
    const arr = map.get(ep) ?? [];
    arr.push(s);
    map.set(ep, arr);
  }
  const sorted = [...map.entries()].sort(([a], [b]) => a - b);
  return sorted.map(([ep, points]) => ({
    key: `ep-${ep}`,
    title: ep > 0 ? `第 ${ep} 話` : "その他",
    points,
  }));
}

function groupByArea(spots: PilgrimagePoint[]): SpotGroupData[] {
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
    title: `エリア ${i + 1}（${points.length} spots）`,
    points,
  }));
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

  const spots = useMemo(() => data?.spots ?? [], [data]);
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
    () => (groupMode === "episode" ? groupByEpisode(spots) : groupByArea(spots)),
    [spots, groupMode],
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
            className="px-5 pb-4 pt-8 sm:px-8"
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

              <div className="flex items-start gap-5">
                {data.cover_url && (
                  <img
                    src={data.cover_url}
                    alt={displayTitle}
                    width={80}
                    height={113}
                    className="h-[113px] w-[80px] shrink-0 rounded-lg object-cover sm:h-[140px] sm:w-[100px]"
                  />
                )}
                <div>
                  <h1 className="font-[family-name:var(--app-font-display)] text-[clamp(24px,5vw,36px)] font-bold leading-[1.1] text-[var(--color-fg)]">
                    {displayTitle}
                  </h1>
                  {titleCn && locale !== "zh" && (
                    <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{titleCn}</p>
                  )}
                  {locale === "zh" && title !== titleCn && (
                    <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{title}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[14px] text-[var(--color-muted-fg)]">
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

          {/* Filmstrip */}
          {spots.length > 0 && (
            <div style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s backwards" }}>
              <Filmstrip points={spots} />
            </div>
          )}

          <main className="mx-auto max-w-[1200px] px-5 pb-12 sm:px-8">
            {/* Map */}
            {spots.length > 0 && (
              <div
                className="mb-4 mt-4 overflow-hidden rounded-2xl border border-[var(--color-border)]"
                style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.15s backwards" }}
              >
                <div className="h-[280px] sm:h-[380px]">
                  <LazyMap points={spots} height="100%" scrollWheelZoom={false} />
                </div>
              </div>
            )}

            {/* CTA */}
            <div
              className="mb-8 rounded-xl bg-[var(--color-card)] p-5 sm:flex sm:items-center sm:justify-between sm:p-7"
              style={{ animation: "seichi-fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.2s backwards" }}
            >
              <div>
                <p className="text-[16px] font-medium text-[var(--color-fg)]">{t.plan_route}</p>
                <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">{t.plan_route_sub}</p>
              </div>
              <Link
                href={`/chat?q=${encodeURIComponent(locale === "zh" && titleCn ? titleCn : title)}`}
                className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[var(--color-primary)] px-7 text-[15px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90 sm:mt-0"
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
                <GroupToggle value={groupMode} onChange={setGroupMode} />
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
