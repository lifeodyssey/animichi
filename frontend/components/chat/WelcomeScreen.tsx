"use client";

import Image from "next/image";
import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Dict, Locale } from "../../lib/i18n";
import { fetchPopularBangumi, type PopularBangumiEntry } from "../../lib/api";
import { popularSpotQuery } from "../../lib/quick-actions";
import { ANIME_COVERS } from "../../lib/mock-data";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import ToriiIcon from "../icons/ToriiIcon";

/* ── Module-level constants (stable references, never re-created) ── */

const FALLBACK_COVERS: PopularBangumiEntry[] = [
  { bangumi_id: "115908", title: "響け！ユーフォニアム", cover_url: ANIME_COVERS["115908"] },
  { bangumi_id: "160209", title: "君の名は。", cover_url: ANIME_COVERS["160209"] },
  { bangumi_id: "269235", title: "天気の子", cover_url: ANIME_COVERS["269235"] },
  { bangumi_id: "485", title: "涼宮ハルヒの憂鬱", cover_url: ANIME_COVERS["485"] },
  { bangumi_id: "1424", title: "けいおん！", cover_url: ANIME_COVERS["1424"] },
  { bangumi_id: "362577", title: "すずめの戸締まり", cover_url: ANIME_COVERS["362577"] },
];

const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const NEARBY_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const ROUTE_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);

function getChipData(locale: Locale, ws: Dict["welcome_screen"]) {
  return [
    {
      label: ws.action_search,
      query: locale === "zh" ? "你的名字的取景地在哪" : locale === "en" ? "Show me anime spots for Your Name" : "君の名は の聖地を教えて",
      icon: SEARCH_ICON,
    },
    {
      label: ws.action_nearby,
      query: locale === "zh" ? "告诉我附近的动漫取景地" : locale === "en" ? "Find anime spots near me" : "現在地の近くにある聖地を教えて",
      icon: NEARBY_ICON,
    },
    {
      label: ws.action_route,
      query: locale === "zh" ? "帮我规划吹响上低音号的巡礼路线" : locale === "en" ? "Plan a pilgrimage route for Sound! Euphonium" : "響け！ユーフォニアム の聖地を巡るルートを作って",
      icon: ROUTE_ICON,
    },
  ];
}

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  dict: Dict;
  locale: Locale;
}

/**
 * Welcome screen — centered welcome with pill search input, chips, and covers.
 *
 * Uses shadcn Input. Chips fill the input instead of sending directly.
 * Covers are large enough for touch and show readable titles.
 */
export default function WelcomeScreen({ onSend, dict, locale }: WelcomeScreenProps) {
  const ws = dict.welcome_screen;
  const [popular, setPopular] = useState<PopularBangumiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on desktop
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPopularBangumi()
      .then((data) => { if (!cancelled) setPopular(data); })
      .catch(() => { if (!cancelled) setPopular([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Only trust cover URLs from known CDN domains — API data may contain placeholder URLs
  const isValidCoverUrl = (url: string | null | undefined): boolean =>
    !!url && (url.includes("anitabi.cn") || url.includes("bangumi.tv"));
  const withCovers = popular.filter((p) => isValidCoverUrl(p.cover_url));
  const covers = withCovers.length >= 4
    ? withCovers.slice(0, 5)
    : FALLBACK_COVERS.slice(0, 5);

  // Returning user detection — ref avoids sync setState in effect.
  const [isReturning] = useState(() => {
    if (typeof window === "undefined") return false;
    const visited = localStorage.getItem("seichijunrei_visited");
    if (visited) return true;
    localStorage.setItem("seichijunrei_visited", "1");
    return false;
  });

  const placeholder =
    locale === "zh"
      ? "输入动漫名称，或描述你的巡礼计划…"
      : locale === "en"
        ? "Type an anime name, or describe your trip…"
        : "アニメ名を入力、または旅の計画を…";

  function handleSubmit() {
    if (!query.trim()) return;
    onSend(query);
    setQuery("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  /** Chips fill the input instead of sending — user retains control. */
  function handleChipClick(chipQuery: string) {
    setQuery(chipQuery);
    inputRef.current?.focus();
  }

  const chipData = React.useMemo(() => getChipData(locale, ws), [locale, ws]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 pb-4">
      {/* Torii logo */}
      <div className="entrance-up mb-3">
        <ToriiIcon size={40} />
      </div>

      {/* Tagline — personalized for returning users */}
      <h1
        className="entrance-up mb-6 max-w-[20ch] text-center font-display text-2xl font-bold leading-snug text-foreground"
        style={{ animationDelay: "0.05s" }}
      >
        {isReturning ? (ws.tagline_returning ?? ws.tagline) : ws.tagline}
      </h1>

      {/* Pill search input — Input + send button */}
      <div
        className="entrance-up mb-4 flex w-full max-w-[520px] items-center gap-2"
        style={{ animationDelay: "0.1s" }}
      >
        <Input shadow
          ref={inputRef}
          size="large"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          prefix={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          className="flex-1"
        />
        <Button
          type="primary"
          size="small" className="animal-btn-icon-only"
          onClick={handleSubmit}
          disabled={!query.trim()}
          aria-label={dict.chat.send}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </Button>
      </div>

      {/* Quick-action chips — fill input, don't send directly */}
      <div
        className="entrance-up mb-7 flex flex-wrap justify-center gap-2"
        style={{ animationDelay: "0.15s" }}
      >
        {chipData.map((chip) => (
          <Button
            key={chip.label}
            type="default" className="animal-btn-chip"
            size="small"
            onClick={() => handleChipClick(chip.query)}
          >
            <span className="text-primary">{chip.icon}</span>
            {chip.label}
          </Button>
        ))}
      </div>

      {/* Popular anime covers — larger, readable titles */}
      <div
        className="entrance-up flex flex-col items-center"
        style={{ animationDelay: "0.2s" }}
      >
        <span className="mb-2.5 text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {ws.popular_label}
        </span>
        <div className="flex gap-4">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex shrink-0 flex-col items-center gap-1.5">
                  <div className="skeleton h-[88px] w-[64px]" />
                  <div className="skeleton h-3 w-12" />
                </div>
              ))
            : covers.map((item, idx) => (
                <Button
                  key={`${item.bangumi_id}-${idx}`}
                  ghost
                  onClick={() => handleChipClick(popularSpotQuery(item.title, locale))}
                  className="group flex h-auto shrink-0 flex-col items-center gap-1.5 border-transparent px-0 py-0"
                  title={item.title}
                  aria-label={item.title}
                >
                  {item.cover_url ? (
                    <Image
                      unoptimized
                      src={item.cover_url}
                      alt={item.title}
                      width={64}
                      height={88}
                      className="h-[88px] w-[64px] rounded-md border border-border object-cover transition-transform group-hover:-translate-y-0.5"
                      style={{ transitionDuration: "var(--duration-fast)" }}
                    />
                  ) : (
                    <div className="flex h-[88px] w-[64px] items-center justify-center rounded-md border border-border bg-card text-lg text-muted-foreground">
                      {item.title.charAt(0)}
                    </div>
                  )}
                  <span className="flex max-w-[64px] flex-col items-center gap-0.5">
                    <span className="truncate text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
                      {item.title.length > 7 ? `${item.title.slice(0, 6)}…` : item.title}
                    </span>
                    {(item.points_count ?? 0) > 0 && (
                      <span className="text-[9px] text-muted-foreground/70">
                        {item.points_count} spots
                      </span>
                    )}
                  </span>
                </Button>
              ))}
        </div>
      </div>

      {/* Tips — progressive disclosure for first-time users */}
      <div
        className="entrance-up mt-8 flex flex-col gap-1 text-xs text-muted-foreground"
        style={{ animationDelay: "0.25s" }}
      >
        <p className="text-center font-medium">{ws.tips_label}</p>
        <p>{ws.tip_search}</p>
        <p>{ws.tip_nearby}</p>
        <p>{ws.tip_route}</p>
      </div>
    </div>
  );
}
