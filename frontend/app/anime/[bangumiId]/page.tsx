"use client";

import { useEffect, useReducer } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDict, useLocale } from "../../../lib/i18n-context";
import { fetchAnimeGuide } from "../../../lib/api";
import type { AnimeGuideResponse } from "../../../lib/api";
import type { PilgrimagePoint } from "../../../lib/types";
import { handleImageError } from "../../../components/auth/LandingData";

const LazyMap = dynamic(() => import("../../../components/map/BaseMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[var(--color-card)] text-[14px] text-[var(--color-muted-fg)]">
      Loading map...
    </div>
  ),
});

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

  const spots = data?.spots ?? [];
  const title = data?.title ?? "";
  const titleCn = data?.title_cn;
  const displayTitle = locale === "zh" && titleCn ? titleCn : title;

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)]"
      style={{ fontFamily: "var(--app-font-body)" }}
    >
      {/* ── Header (shared style with Landing) ── */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 sm:px-8"
        style={{ background: "var(--color-bg)" }}
      >
        <Link
          href="/"
          className="flex items-baseline gap-3"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          <span className="text-[28px] font-bold tracking-[0.02em] text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[12px] tracking-[2px] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </Link>
        <Link
          href="/?login=true"
          className="rounded-lg px-5 py-2.5 text-[14px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card)]"
          style={{ border: "1px solid var(--color-border)" }}
        >
          {dict.landing_hero.landing.login}
        </Link>
      </header>

      {/* ── Loading ── */}
      {status === "loading" && (
        <div className="flex items-center justify-center py-32 text-[16px] text-[var(--color-muted-fg)]">
          <span
            className="mr-3 inline-block h-4 w-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          {t.loading}
        </div>
      )}

      {/* ── Not found ── */}
      {status === "not_found" && (
        <div className="py-32 text-center">
          <p className="text-[18px] font-medium text-[var(--color-fg)]">{t.not_found}</p>
          <p className="mt-2 text-[14px] text-[var(--color-muted-fg)]">{t.not_found_hint}</p>
          <Link href="/" className="mt-6 inline-block text-[14px] text-[var(--color-primary)] hover:underline">
            {t.back_to_home}
          </Link>
        </div>
      )}

      {/* ── Error ── */}
      {status === "error" && (
        <div className="py-32 text-center">
          <p className="text-[16px] text-[var(--color-muted-fg)]">{t.error}</p>
          <Link href="/" className="mt-4 inline-block text-[14px] text-[var(--color-primary)] hover:underline">
            {t.back_to_home}
          </Link>
        </div>
      )}

      {/* ── Guide content ── */}
      {status === "done" && data && (
        <main className="mx-auto max-w-[1200px] px-5 pb-24 pt-8 sm:px-8">
          {/* ── Back link ── */}
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-[14px] text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
          >
            <span aria-hidden="true">←</span>
            {t.back_to_home}
          </Link>

          {/* ── Hero: cover + title + stats ── */}
          <div className="mb-8 flex items-start gap-6">
            {data.cover_url && (
              <img
                src={data.cover_url}
                alt={displayTitle}
                className="h-24 w-[68px] shrink-0 rounded-lg object-cover sm:h-32 sm:w-[90px]"
                onError={handleImageError}
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
              <div className="mt-2 flex items-center gap-3 text-[14px] text-[var(--color-muted-fg)]">
                <span className="font-medium text-[var(--color-fg)]">
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

          {/* ── Map ── */}
          {spots.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--color-border)]">
              <div className="h-[320px] sm:h-[420px]">
                <LazyMap
                  points={spots}
                  height="100%"
                  scrollWheelZoom={false}
                />
              </div>
            </div>
          )}

          {/* ── CTA: Plan route with AI ── */}
          <div
            className="mb-10 rounded-xl bg-[var(--color-card)] p-6 sm:flex sm:items-center sm:justify-between sm:p-8"
          >
            <div>
              <p className="text-[16px] font-medium text-[var(--color-fg)]">
                {t.plan_route}
              </p>
              <p className="mt-1 text-[14px] text-[var(--color-muted-fg)]">
                {t.plan_route_sub}
              </p>
            </div>
            <Link
              href={`/chat?q=${encodeURIComponent(title)}`}
              className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[var(--color-primary)] px-8 text-[15px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90 sm:mt-0"
            >
              {t.plan_route}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* ── Spot list ── */}
          <h2 className="mb-4 font-[family-name:var(--app-font-display)] text-[20px] font-bold text-[var(--color-fg)]">
            {t.spots_label.replace("{count}", String(data.spot_count))}
          </h2>

          <div className="space-y-3">
            {spots.map((point: PilgrimagePoint) => {
              const showEp = point.episode != null && point.episode > 0;
              const name = locale === "zh" && point.name_cn ? point.name_cn : point.name;
              return (
                <div
                  key={point.id}
                  className="flex gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 transition-colors hover:bg-[var(--color-card)]"
                >
                  {point.screenshot_url && (
                    <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg sm:h-24 sm:w-36">
                      <img
                        src={point.screenshot_url}
                        alt={name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={handleImageError}
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium text-[var(--color-fg)]">
                      {name}
                    </div>
                    {showEp && (
                      <div className="mt-1 text-[13px] text-[var(--color-muted-fg)]">
                        {t.episode_label.replace("{ep}", String(point.episode))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}
    </div>
  );
}
