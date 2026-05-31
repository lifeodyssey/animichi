"use client";

import { useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { haversineM, formatDistance } from "../../lib/geo";
import { Button } from "@/components/ui/button";
import BeforeAfter from "./BeforeAfter";

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
// NearbyList sub-component
// ---------------------------------------------------------------------------

function NearbyList({
  nearby,
  title,
}: {
  nearby: (PilgrimagePoint & { dist: number })[];
  title: string;
}) {
  if (nearby.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground font-display">
        {title}
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {nearby.map((p) => (
          <li
            key={p.id}
            className="flex items-baseline justify-between gap-2 text-sm"
          >
            <span className="truncate text-foreground">{p.name_cn || p.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatDistance(p.dist)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  const { spot_detail: t, before_after: ba } = useDict();

  const pending = useRef(false);

  const handleSelect = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    onSelect?.(point.id);
    requestAnimationFrame(() => { pending.current = false; });
  }, [onSelect, point.id]);

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
        <Button
          type="link"
          size="small"
          onClick={onBack}
          className="mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          {t.back}
        </Button>

        {/* BeforeAfter — anime↔real first-class block */}
        <BeforeAfter
          leftSrc={point.screenshot_url ?? ""}
          rightSrc={point.real_photo_url ?? ""}
          leftAlt={point.name_cn || point.name}
          rightAlt={point.name_cn || point.name}
          leftLabel={ba.anime_label}
          rightLabel={ba.real_label}
          draggable
          className="w-full"
        />

        {/* Spot name */}
        <h2 className="mt-3 font-display text-lg font-bold leading-tight text-foreground">
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
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {t.timestamp_label} {formatTime(point.time_seconds)}
        </p>

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type={isSelected ? "dashed" : "primary"}
            onClick={handleSelect}
          >
            {isSelected ? t.remove_spot : t.add_spot}
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
        <NearbyList nearby={nearby} title={t.nearby_title} />
      </div>
    </div>
  );
}
