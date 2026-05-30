"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { haversineM, formatDistance } from "../../lib/geo";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Lazy BaseMap — Mapbox GL requires window
// ---------------------------------------------------------------------------

const LazyMap = dynamic(() => import("../map/BaseMap"), { ssr: false });

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number | null): string {
  if (seconds == null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpotDetailProps {
  point: PilgrimagePoint;
  onBack: () => void;
  onSelect?: (id: string) => void;
  isSelected?: boolean;
  nearbyPoints?: PilgrimagePoint[];
}

// ---------------------------------------------------------------------------
// SpotDetail
// ---------------------------------------------------------------------------

export default function SpotDetail({
  point,
  onBack,
  onSelect,
  isSelected,
  nearbyPoints,
}: SpotDetailProps) {
  const { spot_detail: t } = useDict();

  // 5 closest other points, sorted by distance
  const nearby = useMemo(() => {
    if (!nearbyPoints) return [];
    return nearbyPoints
      .filter((p) => p.id !== point.id)
      .map((p) => ({
        ...p,
        dist: haversineM(point.latitude, point.longitude, p.latitude, p.longitude),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
  }, [nearbyPoints, point]);

  const googleMapsUrl = `https://www.google.com/maps?q=${point.latitude},${point.longitude}`;

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* ── Left column (55%) ──────────────────────────────────────────── */}
      <div className="flex w-[55%] shrink-0 flex-col overflow-y-auto p-5">
        {/* Back button */}
        <Button
          type="link"
          size="small"
          onClick={onBack}
          className="mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          {t.back}
        </Button>

        {/* Large screenshot */}
        <div className="w-full overflow-hidden rounded-lg aspect-[4/3]">
          {point.screenshot_url ? (
            <img
              src={point.screenshot_url}
              alt={point.name}
              width={400}
              height={300}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </div>
          )}
        </div>

        {/* Spot name */}
        <h2
          className="mt-3 font-display text-lg font-bold leading-tight text-foreground"
        >
          {point.name_cn || point.name}
        </h2>

        {/* Anime info */}
        <p className="mt-1 text-sm text-muted-foreground">
          {point.title_cn || point.title || ""}
          {point.episode != null ? ` · ${t.episode.replace("{ep}", String(point.episode))}` : ""}
        </p>

        {/* Address */}
        {point.address && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.address_label} {point.address}
          </p>
        )}

        {/* Timestamp */}
        <p
          className="mt-1 text-xs tabular-nums text-muted-foreground"
        >
          {t.timestamp_label} {formatTime(point.time_seconds)}
        </p>

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type={isSelected ? "dashed" : "primary"}
            onClick={() => onSelect?.(point.id)}
          >
            {isSelected ? t.selected : t.select}
          </Button>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button type="default">
              {t.view_on_map}
            </Button>
          </a>
        </div>
      </div>

      {/* ── Right column (45%) ─────────────────────────────────────────── */}
      <div className="flex w-[45%] flex-col gap-4 overflow-y-auto border-l border-border p-5">
        {/* Mini map */}
        <div className="w-full overflow-hidden rounded-lg h-[280px]">
          <LazyMap
            points={[point]}
            height={280}
            scrollWheelZoom={false}
          />
        </div>

        {/* Nearby spots */}
        {nearby.length > 0 && (
          <div>
            <h3
              className="text-sm font-semibold text-foreground font-display"
            >
              {t.nearby_title}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {nearby.map((p) => (
                <li
                  key={p.id}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="truncate text-foreground">
                    {p.name_cn || p.name}
                  </span>
                  <span
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  >
                    {formatDistance(p.dist)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
